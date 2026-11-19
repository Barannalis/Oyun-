import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './schema.js';

/**
 * Thin wrapper over node:sqlite (built in, no native build step).
 * `transaction(fn)` nests safely via SAVEPOINTs, so services can compose
 * atomic operations. All work is synchronous, so each transaction is isolated
 * within this process.
 */
export class Database {
  /** @param {string} file ':memory:' or a path */
  constructor(file = ':memory:') {
    this.raw = new DatabaseSync(file);
    this.depth = 0;
    this.raw.exec('PRAGMA foreign_keys = ON;');
    if (file !== ':memory:') this.raw.exec('PRAGMA journal_mode = WAL;');
    this.migrate();
  }

  migrate() {
    const current = this.raw.prepare('PRAGMA user_version').get().user_version;
    for (let i = current; i < MIGRATIONS.length; i += 1) {
      this.raw.exec('BEGIN');
      try {
        this.raw.exec(MIGRATIONS[i]);
        this.raw.exec(`PRAGMA user_version = ${i + 1}`);
        this.raw.exec('COMMIT');
      } catch (err) {
        this.raw.exec('ROLLBACK');
        throw err;
      }
    }
  }

  prepare(sql) { return this.raw.prepare(sql); }

  /** Run `fn` atomically. Rolls back on any thrown error. */
  transaction(fn) {
    const name = `sp_${this.depth}`;
    this.raw.exec(`SAVEPOINT ${name}`);
    this.depth += 1;
    try {
      const result = fn();
      this.depth -= 1;
      this.raw.exec(`RELEASE ${name}`);
      return result;
    } catch (err) {
      this.depth -= 1;
      this.raw.exec(`ROLLBACK TO ${name}`);
      this.raw.exec(`RELEASE ${name}`);
      throw err;
    }
  }

  close() { this.raw.close(); }
}
