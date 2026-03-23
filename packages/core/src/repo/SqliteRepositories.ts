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
      const nextQty = qty + input.qty;
      avgPrice = nextQty === 0 ? 0 : (qty * avgPrice + input.qty * input.price) / nextQty;
      qty = nextQty;
    } else {
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

  public updateMarkPrice(symbol: string, lastPrice: number): void {
    const row = this.db
      .prepare("SELECT qty, avg_price, realized_pnl FROM positions WHERE symbol = ?")
      .get(symbol) as Record<string, unknown> | undefined;

    if (!row) {
      return;
    }

    const qty = Number(row.qty);
    const avgPrice = Number(row.avg_price);
    const realizedPnl = Number(row.realized_pnl);
    const unrealizedPnl = (lastPrice - avgPrice) * qty;

    this.db
      .prepare(
        `UPDATE positions
         SET last_price = ?, unrealized_pnl = ?, updated_at = ?
         WHERE symbol = ?`
      )
      .run(lastPrice, unrealizedPnl, isoNow(), symbol);

    const today = isoNow().slice(0, 10);
    this.db
      .prepare(
        `INSERT INTO daily_pnl(date, realized_pnl, unrealized_pnl, total_pnl, updated_at)
         VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(date) DO UPDATE SET
         unrealized_pnl = excluded.unrealized_pnl,
         total_pnl = excluded.total_pnl,
         updated_at = excluded.updated_at`
      )
      .run(today, realizedPnl, unrealizedPnl, realizedPnl + unrealizedPnl, isoNow());
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
      return {
        date,
        realizedPnl: 0,
        unrealizedPnl: 0,
        totalPnl: 0
      };
    }

    return {
      date: String(row.date),
      realizedPnl: Number(row.realized_pnl),
      unrealizedPnl: Number(row.unrealized_pnl),
      totalPnl: Number(row.total_pnl)
    };
  }

  public append(category: string, payload: unknown, ts = isoNow()): void {
    this.db.prepare("INSERT INTO journal_logs(category, payload, ts) VALUES(?, ?, ?)").run(
      category,
      JSON.stringify(payload),
      ts
    );
  }

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

    return {
      ...base,
      price: Number(row.price)
    };
  }
}
