import type { ExecutionUpdate, MarketEvent, OrderIntent } from "@trading/shared-domain";

export interface KisAuthToken {
  accessToken: string;
  expiresAt: number;
}

export interface KisCredentials {
  appKey: string;
  appSecret: string;
  accountNumber: string;
  productCode: string;
  paperTrading: boolean;
  baseUrl: string;
  wsUrl: string;
}

export interface PlaceOrderResponse {
  orderId: string;
  status: "NEW" | "REJECTED";
  message?: string;
}

export interface KisRestClient {
  ensureAccessToken(): Promise<string>;
  placeOrder(order: OrderIntent, idempotencyKey: string): Promise<PlaceOrderResponse>;
  cancelOrder(orderId: string): Promise<void>;
  amendOrder(orderId: string, qty: number, price?: number): Promise<void>;
  getOrderUpdates(sinceIso: string): Promise<ExecutionUpdate[]>;
  getLatestQuote(symbol: string): Promise<MarketEvent>;
}

export interface KisWsClient {
  start(symbols: string[]): Promise<void>;
  stop(): Promise<void>;
}
