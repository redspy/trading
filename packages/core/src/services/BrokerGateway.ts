import type { ExecutionUpdate, OrderIntent } from "@trading/shared-domain";

export interface BrokerGateway {
  placeOrder(order: OrderIntent, idempotencyKey: string): Promise<{
    orderId: string;
    status: "NEW" | "REJECTED";
    message?: string;
  }>;
  cancelOrder(orderId: string): Promise<void>;
  amendOrder(orderId: string, qty: number, price?: number): Promise<void>;
  pullOrderUpdates(sinceIso: string): Promise<ExecutionUpdate[]>;
}
