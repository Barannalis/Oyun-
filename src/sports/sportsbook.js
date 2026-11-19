import { SELECTIONS, owners } from '../core/domain.js';
import { parseDecimalOdds, mulBps, assertPositiveMinor } from '../core/money.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../core/errors.js';
import { newId } from '../core/domain.js';

/**
 * Pre-match sportsbook with a 1X2-style market. A bet debits the player's
 * wallet into the house account and records the potential payout at placement.
 * Settlement pays winners from the house account. Odds never change after a
 * bet is placed.
 */
export class Sportsbook {
  constructor({ db, clock, ledger, engine, platform, audit }) {
    this.db = db;
    this.clock = clock;
    this.ledger = ledger;
    this.engine = engine;
    this.platform = platform;
    this.audit = audit;
  }

  /** Pull the provider schedule into the local event table. */
  async sync(provider, actor) {
    const now = this.clock.now();
    const events = await provider.fetchSchedule(now);
    let upserted = 0;
    this.db.transaction(() => {
      for (const e of events) {
        const id = `${provider.id}:${e.externalId}`;
        const odds = {
          home: parseDecimalOdds(e.odds.home),
          away: parseDecimalOdds(e.odds.away),
          draw: e.odds.draw ? parseDecimalOdds(e.odds.draw) : null,
        };
        this.db
          .prepare(`INSERT INTO sports_events (id, sport, competition, region, starts_at, home, away, odds, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')
                    ON CONFLICT(id) DO UPDATE SET starts_at = excluded.starts_at, home = excluded.home,
                      away = excluded.away, odds = excluded.odds, competition = excluded.competition
                    WHERE sports_events.status = 'scheduled'`)
          .run(id, e.sport, e.competition, e.region, e.startsAt.toISOString(), e.home, e.away, JSON.stringify(odds));
        upserted += 1;
      }
    });
    this.audit.record({ actor, action: 'sports.sync', subject: provider.id, details: { events: upserted } });
    return { upserted };
  }

  /** Events still open for betting now, soonest first. */
  listOpen() {
    const now = this.clock.now().toISOString();
    return this.db
      .prepare("SELECT * FROM sports_events WHERE status = 'scheduled' AND starts_at > ? ORDER BY starts_at LIMIT 200")
      .all(now)
      .map(mapEvent);
  }

  getEvent(id) {
    const r = this.db.prepare('SELECT * FROM sports_events WHERE id = ?').get(id);
    if (!r) throw new NotFoundError('event');
    return mapEvent(r);
  }

  /**
   * @param {{user: object, mode: 'virtual'|'real', currency: string, eventId: string,
   *          selection: string, stakeMinor: number}} input
   */
  placeBet({ user, mode, currency, eventId, selection, stakeMinor }) {
    const event = this.getEvent(eventId);
    if (event.status !== 'scheduled' || Date.parse(event.startsAt) <= this.clock.now().getTime()) {
      throw new ConflictError('event_closed');
    }
    if (!SELECTIONS.includes(selection) || event.odds[selection] == null) {
      throw new ValidationError('invalid_selection');
    }
    // Compliance first, so a player sees the real reason (license, age, KYC...) before stake limits.
    const decision = this.engine.evaluate({
      user,
      mode,
      category: 'sports',
      gameKey: `sport:${event.sport}`,
      action: 'bet',
      currency,
      amountMinor: stakeMinor,
    });
    if (!decision.allowed) throw new ForbiddenError(decision.reasons);
    assertStakeInRange(this.platform, mode, currency, stakeMinor);

    const oddsBp = event.odds[selection];
    const potential = mulBps(stakeMinor, oddsBp);
    const id = newId('bet');
    const now = this.clock.now().toISOString();
    return this.db.transaction(() => {
      const posted = this.ledger.post({
        type: 'bet_stake',
        mode,
        currency,
        legs: [
          { owner: owners.user(user.id), amount: -stakeMinor },
          { owner: owners.house(mode), amount: stakeMinor },
        ],
        metadata: { betId: id, eventId },
      });
      this.db
        .prepare(`INSERT INTO bets (id, user_id, mode, currency, jurisdiction, event_id, selection, odds_bp, stake, potential_payout, status, payout, tx_id, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 0, ?, ?)`)
        .run(id, user.id, mode, currency, decision.jurisdiction, eventId, selection, oddsBp, stakeMinor, potential, posted.id, now);
      return this.getBet(id);
    });
  }

  /** Operator records the result. Pays winners exactly once. */
  settle({ eventId, result, actor }) {
    if (!SELECTIONS.includes(result)) throw new ValidationError('invalid_selection');
    const event = this.getEvent(eventId);
    if (event.status === 'settled') throw new ConflictError('event_already_settled');
    if (result === 'draw' && event.odds.draw == null) throw new ValidationError('invalid_selection');
    const now = this.clock.now().toISOString();

    return this.db.transaction(() => {
      const bets = this.db.prepare("SELECT * FROM bets WHERE event_id = ? AND status = 'open'").all(eventId);
      let winners = 0;
      for (const b of bets) {
        const won = b.selection === result;
        if (won) {
          winners += 1;
          this.ledger.post({
            type: 'bet_payout',
            mode: b.mode,
            currency: b.currency,
            legs: [
              { owner: owners.house(b.mode), amount: -b.potential_payout },
              { owner: owners.user(b.user_id), amount: b.potential_payout },
            ],
            idempotencyKey: `bet_payout:${b.id}`,
            metadata: { betId: b.id },
          });
        }
        this.db
          .prepare("UPDATE bets SET status = ?, payout = ?, settled_at = ? WHERE id = ?")
          .run(won ? 'won' : 'lost', won ? b.potential_payout : 0, now, b.id);
      }
      this.db.prepare("UPDATE sports_events SET status = 'settled', result = ?, settled_at = ? WHERE id = ?").run(result, now, eventId);
      this.audit.record({ actor, action: 'sports.settle', subject: eventId, details: { result, bets: bets.length, winners } });
      return { settled: bets.length, winners };
    });
  }

  getBet(id) {
    const r = this.db.prepare('SELECT * FROM bets WHERE id = ?').get(id);
    if (!r) throw new NotFoundError('bet');
    return mapBet(r);
  }

  listBets(userId) {
    return this.db.prepare('SELECT * FROM bets WHERE user_id = ? ORDER BY created_at DESC LIMIT 200').all(userId).map(mapBet);
  }
}

/** Stake limits are per currency. Real money with no configured cap is refused (fail closed). */
export function assertStakeInRange(platform, mode, currency, stakeMinor) {
  assertPositiveMinor(stakeMinor, 'stake');
  const max = platform.betting.max_stake_minor[currency];
  const min = platform.betting.min_stake_minor?.[currency] ?? 1;
  if (max === undefined) throw new ValidationError('stake_out_of_range', { reason: 'no_cap_configured' });
  if (stakeMinor < min || stakeMinor > max) throw new ValidationError('stake_out_of_range', { min, max });
  return true;
}

function mapEvent(r) {
  return {
    id: r.id,
    sport: r.sport,
    competition: r.competition,
    region: r.region,
    startsAt: r.starts_at,
    home: r.home,
    away: r.away,
    odds: JSON.parse(r.odds),
    status: r.status,
    result: r.result,
  };
}

function mapBet(r) {
  return {
    id: r.id,
    userId: r.user_id,
    mode: r.mode,
    currency: r.currency,
    jurisdiction: r.jurisdiction,
    eventId: r.event_id,
    selection: r.selection,
    oddsBp: r.odds_bp,
    stake: r.stake,
    potentialPayout: r.potential_payout,
    status: r.status,
    payout: r.payout,
    createdAt: r.created_at,
    settledAt: r.settled_at,
  };
}
