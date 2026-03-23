import { randomUUID } from "node:crypto";
import type { ExecutionUpdate, OrderIntent } from "@trading/shared-domain";
import type { BrokerGateway } from "./BrokerGateway.js";

export class PaperBrokerGateway implements BrokerGateway {
  private readonly updates: ExecutionUpdate[] = [];

  public async placeOrder(order: OrderIntent): Promise<{ orderId: string; status: "NEW" | "REJECTED" }> {
    const orderId = randomUUID();
    const ts = new Date().toISOString();
    this.updates.push({
      orderId,
      status: "FILLED",
      filledQty: order.qty,
      avgPrice: order.price ?? 0,
      ts
    });
    return { orderId, status: "NEW" };
  }

  public async cancelOrder(_orderId: string): Promise<void> {
    return;
  }

  public async amendOrder(_orderId: string, _qty: number, _price?: number): Promise<void> {
    return;
  }

  public async pullOrderUpdates(sinceIso: string): Promise<ExecutionUpdate[]> {
    const sinceMs = Date.parse(sinceIso);
    return this.updates.filter((update) => Date.parse(update.ts) >= sinceMs);
  }
}
