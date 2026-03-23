import { DatabaseSync } from "node:sqlite";
import { runMigrations } from "./migrations.js";

export class AppDatabase {
  public readonly db: DatabaseSync;

  public constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.db.exec("PRAGMA busy_timeout=5000;");
    this.db.exec("PRAGMA foreign_keys=ON;");
    runMigrations(this.db);
  }

  public transaction<T>(work: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
