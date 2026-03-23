import type { KisRestClient } from "@trading/kis-client";
import type { ExecutionUpdate, OrderIntent } from "@trading/shared-domain";
import type { BrokerGateway } from "./BrokerGateway.js";

export class KisBrokerGateway implements BrokerGateway {
  public constructor(private readonly client: KisRestClient) {}

  public async placeOrder(order: OrderIntent, idempotencyKey: string): Promise<{
    orderId: string;
    status: "NEW" | "REJECTED";
    message?: string;
  }> {
    return this.client.placeOrder(order, idempotencyKey);
  }

  public async cancelOrder(orderId: string): Promise<void> {
    await this.client.cancelOrder(orderId);
  }

  public async amendOrder(orderId: string, qty: number, price?: number): Promise<void> {
    await this.client.amendOrder(orderId, qty, price);
  }

  public async pullOrderUpdates(sinceIso: string): Promise<ExecutionUpdate[]> {
    return this.client.getOrderUpdates(sinceIso);
  }
}
