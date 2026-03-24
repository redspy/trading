import type { ExecutionUpdate, MarketEvent, OrderIntent } from "@trading/shared-domain";
import type { KisRestClient, PlaceOrderResponse } from "../types.js";

export class MockKisRestClient implements KisRestClient {
  public async ensureAccessToken(): Promise<string> {
    return "mock-access-token";
  }

  public async getApprovalKey(): Promise<string> {
    return "mock-approval-key";
  }

  public async placeOrder(order: OrderIntent, _idempotencyKey: string): Promise<PlaceOrderResponse> {
    return {
      orderId: `mock-order-${Date.now()}`,
      status: "NEW"
    };
  }

  public async cancelOrder(_orderId: string): Promise<void> {
    return;
  }

  public async amendOrder(_orderId: string, _qty: number, _price?: number): Promise<void> {
    return;
  }

  public async getOrderUpdates(_sinceIso: string): Promise<ExecutionUpdate[]> {
    return [];
  }

  public async getLatestQuote(symbol: string): Promise<MarketEvent> {
    return {
      symbol,
      ts: new Date().toISOString(),
      price: 50000 + Math.floor(Math.random() * 1000),
      volume: Math.floor(Math.random() * 100),
      source: "REST"
    };
  }
}
