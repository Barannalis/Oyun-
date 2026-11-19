import { randomInt } from 'node:crypto';
import { newId, owners } from '../core/domain.js';
import { mulRatio, getCurrency } from '../core/money.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../core/errors.js';
import { assertStakeInRange } from '../sports/sportsbook.js';

/**
 * Casino game registry. Every game is a provider-side unit with a stable id and
 * a restriction key (`game:<id>`) that jurisdictions can block individually.
 *
 * Real aggregator integrations (third-party game studios) implement the same
 * shape and are registered here. Their outcomes must come from a certified RNG
 * supplied by the provider; the built-in game below is for the virtual MVP.
 */
export const BUILT_IN_GAMES = Object.freeze([
  {
    id: 'dice',
    name: 'Dice',
    category: 'casino',
    /** Win when roll < target, where roll is uniform in [0, 100). Payout = stake * 99 / target (1% edge). */
    play({ stakeMinor, params, rng }) {
      const target = Number(params?.target);
      if (!Number.isInteger(target) || target < 2 || target > 98) throw new ValidationError('invalid_target');
      const roll = rng(100);
      const won = roll < target;
      const payout = won ? mulRatio(stakeMinor, 99, target) : 0;
      return { payout, outcome: { roll, target, won } };
    },
  },
]);

export class CasinoService {
  /**
   * @param {{games?: typeof BUILT_IN_GAMES, rng?: (n: number) => number}} deps
   */
  constructor({ db, clock, ledger, engine, platform, games = BUILT_IN_GAMES, rng = (n) => randomInt(n) }) {
    this.db = db;
    this.clock = clock;
    this.ledger = ledger;
    this.engine = engine;
    this.platform = platform;
    this.games = new Map(games.map((g) => [g.id, g]));
    this.rng = rng;
  }

  listGames() {
    return [...this.games.values()].map((g) => ({ id: g.id, name: g.name, category: g.category, restrictionKey: `game:${g.id}` }));
  }

  play({ user, mode, currency, gameId, stakeMinor, params }) {
    const game = this.games.get(gameId);
    if (!game) throw new NotFoundError('game');
    const decision = this.engine.evaluate({
      user,
      mode,
      category: game.category,
      gameKey: `game:${game.id}`,
      action: 'play',
      currency,
      amountMinor: stakeMinor,
    });
    if (!decision.allowed) throw new ForbiddenError(decision.reasons);
    assertStakeInRange(this.platform, mode, currency, stakeMinor);

    // Outcome is decided before any money moves, so a validation error cannot leave a half-played round.
    const { payout, outcome } = game.play({ stakeMinor, params, rng: this.rng });
    const id = newId('rnd');
    const now = this.clock.now().toISOString();
    return this.db.transaction(() => {
      const legs = [
        { owner: owners.user(user.id), amount: -stakeMinor },
        { owner: owners.house(mode), amount: stakeMinor },
        { owner: owners.house(mode), amount: -payout },
        { owner: owners.user(user.id), amount: payout },
      ];
      const posted = this.ledger.post({ type: 'casino_round', mode, currency, legs, metadata: { roundId: id, gameId } });
      this.db
        .prepare(`INSERT INTO casino_rounds (id, user_id, mode, currency, jurisdiction, game_id, stake, payout, outcome, tx_id, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, user.id, mode, currency, decision.jurisdiction, gameId, stakeMinor, payout, JSON.stringify(outcome), posted.id, now);
      return { id, gameId, stake: stakeMinor, payout, outcome, currency, exponent: getCurrency(currency).exponent, mode };
    });
  }

  listRounds(userId) {
    return this.db.prepare('SELECT * FROM casino_rounds WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').all(userId)
      .map((r) => ({ id: r.id, gameId: r.game_id, mode: r.mode, currency: r.currency, stake: r.stake, payout: r.payout, outcome: JSON.parse(r.outcome), createdAt: r.created_at }));
  }
}
