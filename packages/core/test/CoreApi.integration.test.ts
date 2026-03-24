import { describe, expect, it } from "vitest";
import request from "supertest";
import type {
  DailyPnl,
  ExecutionUpdate,
  MarketEvent,
  OrderRecord,
  Position,
  RiskDecision,
  TradeSignal
} from "@trading/shared-domain";
import { createApp } from "../src/api/createApp.js";
import { ExecutionService } from "../src/services/ExecutionService.js";
import { KoreanMarketSession } from "../src/services/KoreanMarketSession.js";
import { PaperBrokerGateway } from "../src/services/PaperBrokerGateway.js";
import { RuntimeFlags } from "../src/services/RuntimeFlags.js";
import type { EventRepo, JournalRepo, OrderRepo, PositionRepo } from "../src/repo/interfaces.js";

const TEST_API_KEY = "test-internal-key";
const shouldRunSocketTests = process.env.CI_ALLOW_LISTEN === "1";

class InMemoryRepos implements OrderRepo, PositionRepo, JournalRepo, EventRepo {
  private readonly orders = new Map<string, OrderRecord>();
  private readonly clientOrderIndex = new Map<string, string>();

  public create(order: OrderRecord): void {
    this.orders.set(order.id, order);
    this.clientOrderIndex.set(order.clientOrderId, order.id);
  }

  public findById(id: string): OrderRecord | undefined {
    return this.orders.get(id);
  }

  public findByClientOrderId(clientOrderId: string): OrderRecord | undefined {
    const id = this.clientOrderIndex.get(clientOrderId);
    return id ? this.orders.get(id) : undefined;
  }

  public hasActiveOrder(symbol: string, side: "BUY" | "SELL"): boolean {
    return [...this.orders.values()].some(
      (order) =>
        order.symbol === symbol &&
        order.side === side &&
        (order.status === "NEW" || order.status === "PARTIALLY_FILLED")
    );
  }

  public updateExecution(update: ExecutionUpdate): void {
    const existing = this.orders.get(update.orderId);
    if (!existing) {
      return;
    }
    this.orders.set(update.orderId, {
      ...existing,
      status: update.status,
      filledQty: update.filledQty,
      avgPrice: update.avgPrice,
      updatedAt: update.ts
    });
  }

  public listOpenOrders(): OrderRecord[] {
    return [...this.orders.values()].filter(
      (order) => order.status === "NEW" || order.status === "PARTIALLY_FILLED"
    );
  }

  public applyFill(_input: {
    orderId: string;
    symbol: string;
    side: "BUY" | "SELL";
    qty: number;
    price: number;
    ts: string;
  }): void {
    return;
  }

  public updateMarkPrice(_symbol: string, _lastPrice: number): void {
    return;
  }

  public list(): Position[] {
    return [];
  }

  public getDailyPnl(date: string): DailyPnl {
    return { date, realizedPnl: 0, unrealizedPnl: 0, totalPnl: 0 };
  }

  public append(_category: string, _payload: unknown, _ts?: string): void {
    return;
  }

  public insertMarketEvent(_event: MarketEvent): void {
    return;
  }

  public insertSignal(_signal: TradeSignal): void {
    return;
  }

  public insertRiskDecision(_symbol: string, _decision: RiskDecision, _ts: string): void {
    return;
  }

  public insertSystemEvent(_category: string, _message: string, _metadata?: unknown): void {
    return;
  }
}

function createTestApp() {
  const repos = new InMemoryRepos();
  const runtimeFlags = new RuntimeFlags(false);
  const executionService = new ExecutionService(repos, repos, repos, new PaperBrokerGateway(), runtimeFlags, {
    paperMode: true,
    liveMode: false
  });

  return createApp({
    env: {
      INTERNAL_API_KEY: TEST_API_KEY,
      PORT: 0,
      NODE_ENV: "test",
      DATABASE_PATH: "/tmp/unused",
      PAPER_MODE: true,
      LIVE_MODE: false,
      KILL_SWITCH: false,
      RISK_PER_TRADE_PCT: 0.005,
      DAILY_LOSS_LIMIT_PCT: 0.02,
      FIXED_STOP_LOSS_PCT: 0.025,
      MAX_POSITIONS: 5,
      ACCOUNT_EQUITY: 100_000_000,
      WATCHLIST: "005930",
      watchlistSymbols: ["005930"],
      KIS_APP_KEY: "x",
      KIS_APP_SECRET: "x",
      KIS_ACCOUNT_NUMBER: "x",
      KIS_PRODUCT_CODE: "01",
      KIS_BASE_URL: "https://example.com",
      KIS_WS_URL: "wss://example.com"
    },
    db: {} as never,
    repos,
    runtimeFlags,
    marketSession: new KoreanMarketSession(),
    executionService,
    tradingOrchestrator: {
      onMarketEvent: async () => undefined
    }
  });
}

const describeSocket = shouldRunSocketTests ? describe : describe.skip;

describeSocket("Core internal API integration", () => {
  it("places a paper order and blocks duplicate clientOrderId", async () => {
    const app = createTestApp();
    const payload = {
      symbol: "005930",
      side: "BUY",
      qty: 1,
      type: "MARKET",
      tif: "DAY",
      clientOrderId: "dup-order-1"
    };

    const first = await request(app)
      .post("/internal/orders")
      .set("x-internal-api-key", TEST_API_KEY)
      .send(payload);

    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/internal/orders")
      .set("x-internal-api-key", TEST_API_KEY)
      .send(payload);

    expect(second.status).toBe(409);
  });

  it("preflight returns expected shape", async () => {
    const app = createTestApp();
    const res = await request(app)
      .get("/internal/preflight")
      .set("x-internal-api-key", TEST_API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.checks.marketSession).toBe("string");
    expect(res.body.checks.paperMode).toBe(true);
    expect(res.body.checks.liveMode).toBe(false);
    expect(res.body.checks.watchlistCount).toBe(1);
  });

  it("enables kill switch and blocks new orders", async () => {
    const app = createTestApp();

    const enable = await request(app)
      .post("/internal/killswitch/enable")
      .set("x-internal-api-key", TEST_API_KEY);

    expect(enable.status).toBe(200);

    const order = await request(app)
      .post("/internal/orders")
      .set("x-internal-api-key", TEST_API_KEY)
      .send({
        symbol: "005930",
        side: "BUY",
        qty: 1,
        type: "MARKET",
        tif: "DAY",
        clientOrderId: "blocked-order"
      });

    expect(order.status).toBe(422);
  });
});
