export type Side = "BUY" | "SELL";

export type MarketSource = "WS" | "REST";

export interface MarketEvent {
  symbol: string;
  ts: string;
  price: number;
  volume: number;
  source: MarketSource;
}

export interface TradeSignal {
  symbol: string;
  side: Side;
  reason: string;
  confidence: number;
  ts: string;
}

export interface RiskDecision {
  allow: boolean;
  ruleHits: string[];
  maxQty: number;
}

export type OrderType = "MARKET" | "LIMIT";
export type TimeInForce = "DAY" | "IOC" | "FOK";

export interface OrderIntent {
  symbol: string;
  side: Side;
  qty: number;
  type: OrderType;
  price?: number;
  tif: TimeInForce;
  clientOrderId: string;
}

export type ExecutionStatus =
  | "NEW"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELED"
  | "REJECTED";

export interface ExecutionUpdate {
  orderId: string;
  status: ExecutionStatus;
  filledQty: number;
  avgPrice: number;
  ts: string;
}

export interface Position {
  symbol: string;
  qty: number;
  avgPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
}

export interface DailyPnl {
  date: string;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
}

export interface OrderRecord extends OrderIntent {
  id: string;
  status: ExecutionStatus;
  filledQty: number;
  avgPrice: number;
  createdAt: string;
  updatedAt: string;
}
