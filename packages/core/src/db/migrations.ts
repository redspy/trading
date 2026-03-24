// ─────────────────────────────────────────────────────────────
// 데이터베이스 마이그레이션
//
// schema_migrations 테이블에 적용된 버전을 기록한다.
// 이미 적용된 버전은 건너뛰고, 미적용 버전만 순서대로 실행한다.
// 각 마이그레이션은 트랜잭션으로 감싸 원자성을 보장한다.
//
// 테이블 목록 (v1):
//   market_events   — 수신된 실시간 시세 이벤트
//   signals         — 전략 엔진이 생성한 매매 신호
//   risk_decisions  — 리스크 매니저의 허용/차단 결정
//   orders          — 주문 레코드 (상태 포함)
//   fills           — 개별 체결 내역 (orders 참조)
//   positions       — 현재 보유 포지션 및 손익
//   daily_pnl       — 일별 손익 집계
//   journal_logs    — 모든 이벤트의 감사 로그
//   system_events   — 서버 내부 이벤트 (주문 접수, EOD 등)
//   schema_migrations — 마이그레이션 버전 관리
// ─────────────────────────────────────────────────────────────

import type { DatabaseSync } from "node:sqlite";

const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS market_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        ts TEXT NOT NULL,
        price REAL NOT NULL,
        volume REAL NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        reason TEXT NOT NULL,
        confidence REAL NOT NULL,
        ts TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS risk_decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        allow INTEGER NOT NULL,
        rule_hits TEXT NOT NULL,
        max_qty INTEGER NOT NULL,
        ts TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        client_order_id TEXT NOT NULL UNIQUE,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        qty INTEGER NOT NULL,
        type TEXT NOT NULL,
        price REAL,
        tif TEXT NOT NULL,
        status TEXT NOT NULL,
        filled_qty INTEGER NOT NULL,
        avg_price REAL NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS fills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT NOT NULL,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        qty INTEGER NOT NULL,
        price REAL NOT NULL,
        ts TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders(id)
      );

      CREATE TABLE IF NOT EXISTS positions (
        symbol TEXT PRIMARY KEY,
        qty INTEGER NOT NULL,
        avg_price REAL NOT NULL,
        last_price REAL NOT NULL,
        realized_pnl REAL NOT NULL,
        unrealized_pnl REAL NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS daily_pnl (
        date TEXT PRIMARY KEY,
        realized_pnl REAL NOT NULL,
        unrealized_pnl REAL NOT NULL,
        total_pnl REAL NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS journal_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        payload TEXT NOT NULL,
        ts TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS system_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata TEXT,
        ts TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_market_events_symbol_ts ON market_events(symbol, ts);
      CREATE INDEX IF NOT EXISTS idx_orders_symbol_status ON orders(symbol, status);
      CREATE INDEX IF NOT EXISTS idx_fills_order_id ON fills(order_id);
    `
  }
];

export function runMigrations(db: DatabaseSync): void {
  // schema_migrations 테이블이 없으면 먼저 생성
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );`
  );

  const applied = db
    .prepare("SELECT version FROM schema_migrations")
    .all()
    .map((row) => Number((row as Record<string, unknown>).version));

  for (const migration of MIGRATIONS) {
    if (applied.includes(migration.version)) {
      continue;
    }

    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)").run(
        migration.version,
        new Date().toISOString()
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
