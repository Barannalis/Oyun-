/**
 * Sports data provider contract. Real feeds (global leagues, tennis, esports
 * titles) are adapters implementing this interface and registered in code.
 *
 *   id: string
 *   fetchSchedule(now: Date) -> Promise<Array<{
 *     externalId: string, sport: string, competition: string, region: string|null,
 *     startsAt: Date, home: string, away: string, odds: { home: string, draw?: string, away: string }
 *   }>>
 *
 * Odds are decimal strings (e.g. "2.10"). A missing `draw` means the market has
 * no draw outcome. Results are posted by the operator (or a result feed) when settled.
 */

/** Demo provider backed by config/fixtures/sports.json. Start times are relative to sync time. */
export class FixtureSportsProvider {
  /** @param {{events: Array<object>}} fixture */
  constructor(fixture) {
    this.id = 'fixtures';
    this.fixture = fixture;
  }

  async fetchSchedule(now) {
    return this.fixture.events.map((e) => ({
      externalId: e.externalId,
      sport: e.sport,
      competition: e.competition,
      region: e.region ?? null,
      startsAt: new Date(now.getTime() + e.startsInHours * 3600000),
      home: e.home,
      away: e.away,
      odds: e.odds,
    }));
  }
}
