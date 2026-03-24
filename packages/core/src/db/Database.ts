// ─────────────────────────────────────────────────────────────
// SQLite 데이터베이스 초기화
//
// 설정:
//   - WAL(Write-Ahead Logging) 모드: 읽기/쓰기 동시 접근 허용
//   - busy_timeout=5000ms: 락 대기 최대 5초
//   - foreign_keys=ON: 참조 무결성 강제
//
// 마이그레이션은 생성자에서 자동으로 실행된다.
// ─────────────────────────────────────────────────────────────

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

  /** 명시적 트랜잭션이 필요한 경우 사용 (마이그레이션 외부에서 활용 가능) */
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
