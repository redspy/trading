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

export interface OrderRepo {
  create(order: OrderRecord): void;
  findById(id: string): OrderRecord | undefined;
  findByClientOrderId(clientOrderId: string): OrderRecord | undefined;
  hasActiveOrder(symbol: string, side: Side): boolean;
  updateExecution(update: ExecutionUpdate): void;
  listOpenOrders(): OrderRecord[];
}

export interface PositionRepo {
  applyFill(input: {
    orderId: string;
    symbol: string;
    side: Side;
    qty: number;
    price: number;
    ts: string;
  }): void;
  updateMarkPrice(symbol: string, lastPrice: number): void;
  list(): Position[];
  getDailyPnl(date: string): DailyPnl;
}

export interface JournalRepo {
  append(category: string, payload: unknown, ts?: string): void;
}

export interface EventRepo {
  insertMarketEvent(event: MarketEvent): void;
  insertSignal(signal: TradeSignal): void;
  insertRiskDecision(symbol: string, decision: RiskDecision, ts: string): void;
  insertSystemEvent(category: string, message: string, metadata?: unknown): void;
}
