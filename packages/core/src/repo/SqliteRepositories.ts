// ─────────────────────────────────────────────────────────────
// SQLite 리포지토리 구현
//
// OrderRepo, PositionRepo, JournalRepo, EventRepo를 단일 클래스로 구현한다.
// 모든 쓰기 작업은 WAL 모드 SQLite를 통해 ACID 보장된다.
//
// 포지션 손익 계산 방식:
//   - 매수: 가중 평균 단가 갱신 (qty 가중 평균)
//   - 매도: FIFO 기준 실현 손익 = (체결가 - 평균 단가) × 수량
//   - updateMarkPrice: 현재가 기준 미실현 손익 갱신
//     → 전체 포지션 집계로 daily_pnl 업데이트 (멀티 심볼 정합성 보장)
// ─────────────────────────────────────────────────────────────

import type {
  DailyPnl,
  ExecutionUpdate,
  MarketEvent,
  OrderRecord,
  Position,
  RiskDecision,
  Side,
  TradeSignal
} from "@trading/shared-domain";
import type { DatabaseSync } from "node:sqlite";
import type { EventRepo, JournalRepo, OrderRepo, PositionRepo } from "./interfaces.js";

function isoNow(): string {
  return new Date().toISOString();
}

type PositionRow = {
  symbol: string;
  qty: number;
  avg_price: number;
  last_price: number;
  realized_pnl: number;
  unrealized_pnl: number;
};

export class SqliteRepositories implements OrderRepo, PositionRepo, JournalRepo, EventRepo {
  public constructor(private readonly db: DatabaseSync) {}

  // ─── OrderRepo ─────────────────────────────────────────────

  public create(order: OrderRecord): void {
    this.db
      .prepare(
        `INSERT INTO orders (
          id, client_order_id, symbol, side, qty, type, price, tif, status,
          filled_qty, avg_price, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        order.id,
        order.clientOrderId,
        order.symbol,
        order.side,
        order.qty,
        order.type,
        order.price ?? null,
        order.tif,
        order.status,
        order.filledQty,
        order.avgPrice,
        order.createdAt,
        order.updatedAt
      );
  }

  public findById(id: string): OrderRecord | undefined {
    const row = this.db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.toOrderRecord(row) : undefined;
  }

  public findByClientOrderId(clientOrderId: string): OrderRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM orders WHERE client_order_id = ?")
      .get(clientOrderId) as Record<string, unknown> | undefined;
    return row ? this.toOrderRecord(row) : undefined;
  }

  /** NEW/PARTIALLY_FILLED 상태인 동일 심볼/방향 주문 존재 여부 */
  public hasActiveOrder(symbol: string, side: Side): boolean {
    const row = this.db
      .prepare(
        `SELECT COUNT(1) AS c
         FROM orders
         WHERE symbol = ?
           AND side = ?
           AND status IN ('NEW', 'PARTIALLY_FILLED')`
      )
      .get(symbol, side) as Record<string, unknown>;

    return Number(row.c) > 0;
  }

  /**
   * 체결 업데이트를 반영한다.
   * filledQty가 증가한 경우 fills 테이블에 기록하고 포지션도 갱신한다.
   */
  public updateExecution(update: ExecutionUpdate): void {
    const existing = this.findById(update.orderId);
    if (!existing) {
      return;
    }

    this.db
      .prepare(
        `UPDATE orders
         SET status = ?, filled_qty = ?, avg_price = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(update.status, update.filledQty, update.avgPrice, update.ts, update.orderId);

    // 신규 체결 수량이 있으면 fills 기록 및 포지션 반영
    if (update.filledQty > existing.filledQty) {
      const deltaQty = update.filledQty - existing.filledQty;
      this.db
        .prepare(
          `INSERT INTO fills(order_id, symbol, side, qty, price, ts, created_at)
           VALUES(?, ?, ?, ?, ?, ?, ?)`
        )
        .run(update.orderId, existing.symbol, existing.side, deltaQty, update.avgPrice, update.ts, isoNow());
      this.applyFill({
        orderId: update.orderId,
        symbol: existing.symbol,
        side: existing.side,
        qty: deltaQty,
        price: update.avgPrice,
        ts: update.ts
      });
    }
  }

  public listOpenOrders(): OrderRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM orders WHERE status IN ('NEW', 'PARTIALLY_FILLED') ORDER BY created_at DESC")
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => this.toOrderRecord(row));
  }

  // ─── PositionRepo ──────────────────────────────────────────

  /**
   * 체결 정보를 포지션에 반영한다.
   * - 매수: 가중 평균 단가 갱신, 수량 증가
   * - 매도: 실현 손익 계산, 수량 감소
   * 이후 daily_pnl 전체 집계를 갱신한다.
   */
  public applyFill(input: {
    orderId: string;
    symbol: string;
    side: Side;
    qty: number;
    price: number;
    ts: string;
  }): void {
    const row = this.db
      .prepare("SELECT symbol, qty, avg_price, last_price, realized_pnl, unrealized_pnl FROM positions WHERE symbol = ?")
      .get(input.symbol) as PositionRow | undefined;

    let qty = row?.qty ?? 0;
    let avgPrice = row?.avg_price ?? 0;
    let lastPrice = row?.last_price ?? input.price;
    let realizedPnl = row?.realized_pnl ?? 0;

    if (input.side === "BUY") {
      // 가중 평균 단가 갱신
      const nextQty = qty + input.qty;
      avgPrice = nextQty === 0 ? 0 : (qty * avgPrice + input.qty * input.price) / nextQty;
      qty = nextQty;
    } else {
      // 매도: 실현 손익 = (체결가 - 평균 단가) × 체결 수량
      const sellQty = Math.min(qty, input.qty);
      realizedPnl += (input.price - avgPrice) * sellQty;
      qty -= sellQty;
      if (qty === 0) {
        avgPrice = 0;
      }
    }

    lastPrice = input.price;
    const unrealizedPnl = (lastPrice - avgPrice) * qty;

    this.db
      .prepare(
        `INSERT INTO positions(symbol, qty, avg_price, last_price, realized_pnl, unrealized_pnl, updated_at)
         VALUES(?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(symbol) DO UPDATE SET
         qty = excluded.qty,
         avg_price = excluded.avg_price,
         last_price = excluded.last_price,
         realized_pnl = excluded.realized_pnl,
         unrealized_pnl = excluded.unrealized_pnl,
         updated_at = excluded.updated_at`
      )
      .run(input.symbol, qty, avgPrice, lastPrice, realizedPnl, unrealizedPnl, input.ts);

    this.updateDailyPnl(input.ts.slice(0, 10));
  }

  /**
   * 현재가 기준으로 미실현 손익을 갱신한다.
   * 위치 의존 없이 전체 포지션을 집계해 daily_pnl를 갱신한다.
   * (단일 심볼 값으로 덮어쓰는 버그를 방지)
   */
  public updateMarkPrice(symbol: string, lastPrice: number): void {
    const row = this.db
      .prepare("SELECT qty, avg_price, realized_pnl FROM positions WHERE symbol = ?")
      .get(symbol) as Record<string, unknown> | undefined;

    if (!row) {
      return;
    }

    const qty = Number(row.qty);
    const avgPrice = Number(row.avg_price);
    const unrealizedPnl = (lastPrice - avgPrice) * qty;

    this.db
      .prepare(
        `UPDATE positions
         SET last_price = ?, unrealized_pnl = ?, updated_at = ?
         WHERE symbol = ?`
      )
      .run(lastPrice, unrealizedPnl, isoNow(), symbol);

    // 전체 포지션 집계로 daily_pnl 갱신 (멀티 심볼 정합성 보장)
    const today = isoNow().slice(0, 10);
    this.updateDailyPnl(today);
  }

  public list(): Position[] {
    const rows = this.db
      .prepare("SELECT symbol, qty, avg_price, unrealized_pnl, realized_pnl FROM positions ORDER BY symbol")
      .all() as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      symbol: String(row.symbol),
      qty: Number(row.qty),
      avgPrice: Number(row.avg_price),
      unrealizedPnl: Number(row.unrealized_pnl),
      realizedPnl: Number(row.realized_pnl)
    }));
  }

  public getDailyPnl(date: string): DailyPnl {
    const row = this.db
      .prepare("SELECT date, realized_pnl, unrealized_pnl, total_pnl FROM daily_pnl WHERE date = ?")
      .get(date) as Record<string, unknown> | undefined;

    if (!row) {
      return { date, realizedPnl: 0, unrealizedPnl: 0, totalPnl: 0 };
    }

    return {
      date: String(row.date),
      realizedPnl: Number(row.realized_pnl),
      unrealizedPnl: Number(row.unrealized_pnl),
      totalPnl: Number(row.total_pnl)
    };
  }

  // ─── JournalRepo ───────────────────────────────────────────

  public append(category: string, payload: unknown, ts = isoNow()): void {
    this.db.prepare("INSERT INTO journal_logs(category, payload, ts) VALUES(?, ?, ?)").run(
      category,
      JSON.stringify(payload),
      ts
    );
  }

  // ─── EventRepo ─────────────────────────────────────────────

  public insertMarketEvent(event: MarketEvent): void {
    this.db
      .prepare(
        "INSERT INTO market_events(symbol, ts, price, volume, source, created_at) VALUES(?, ?, ?, ?, ?, ?)"
      )
      .run(event.symbol, event.ts, event.price, event.volume, event.source, isoNow());
  }

  public insertSignal(signal: TradeSignal): void {
    this.db
      .prepare(
        "INSERT INTO signals(symbol, side, reason, confidence, ts, created_at) VALUES(?, ?, ?, ?, ?, ?)"
      )
      .run(signal.symbol, signal.side, signal.reason, signal.confidence, signal.ts, isoNow());
  }

  public insertRiskDecision(symbol: string, decision: RiskDecision, ts: string): void {
    this.db
      .prepare(
        "INSERT INTO risk_decisions(symbol, allow, rule_hits, max_qty, ts, created_at) VALUES(?, ?, ?, ?, ?, ?)"
      )
      .run(symbol, decision.allow ? 1 : 0, JSON.stringify(decision.ruleHits), decision.maxQty, ts, isoNow());
  }

  public insertSystemEvent(category: string, message: string, metadata?: unknown): void {
    this.db
      .prepare("INSERT INTO system_events(category, message, metadata, ts) VALUES(?, ?, ?, ?)")
      .run(category, message, metadata ? JSON.stringify(metadata) : null, isoNow());
  }

  // ─── Private ───────────────────────────────────────────────

  /**
   * 모든 포지션의 realized/unrealized 합계로 daily_pnl를 갱신한다.
   * applyFill과 updateMarkPrice 모두 이 메서드를 통해 집계한다.
   */
  private updateDailyPnl(date: string): void {
    const pnl = this.db
      .prepare(
        `SELECT
            COALESCE(SUM(realized_pnl), 0) AS realized,
            COALESCE(SUM(unrealized_pnl), 0) AS unrealized
         FROM positions`
      )
      .get() as Record<string, unknown>;

    const realized = Number(pnl.realized);
    const unrealized = Number(pnl.unrealized);

    this.db
      .prepare(
        `INSERT INTO daily_pnl(date, realized_pnl, unrealized_pnl, total_pnl, updated_at)
         VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(date) DO UPDATE SET
         realized_pnl = excluded.realized_pnl,
         unrealized_pnl = excluded.unrealized_pnl,
         total_pnl = excluded.total_pnl,
         updated_at = excluded.updated_at`
      )
      .run(date, realized, unrealized, realized + unrealized, isoNow());
  }

  private toOrderRecord(row: Record<string, unknown>): OrderRecord {
    const base: Omit<OrderRecord, "price"> = {
      id: String(row.id),
      clientOrderId: String(row.client_order_id),
      symbol: String(row.symbol),
      side: row.side as OrderRecord["side"],
      qty: Number(row.qty),
      type: row.type as OrderRecord["type"],
      tif: row.tif as OrderRecord["tif"],
      status: row.status as OrderRecord["status"],
      filledQty: Number(row.filled_qty),
      avgPrice: Number(row.avg_price),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };

    if (row.price === null || row.price === undefined) {
      return base;
    }

    return { ...base, price: Number(row.price) };
  }
}
