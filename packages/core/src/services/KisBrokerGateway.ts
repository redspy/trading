// ─────────────────────────────────────────────────────────────
// KIS 실거래 브로커 게이트웨이
// LIVE_MODE=true 일 때 사용된다.
// KisRestClient를 통해 KIS Open API에 실제 주문을 전달한다.
// ─────────────────────────────────────────────────────────────

import type { KisRestClient } from "@trading/kis-client";
import type { ExecutionUpdate, OrderIntent } from "@trading/shared-domain";
import type { BrokerGateway } from "./BrokerGateway.js";

export class KisBrokerGateway implements BrokerGateway {
  public constructor(private readonly client: KisRestClient) {}

  /** KIS REST API로 주문 접수 */
  public async placeOrder(order: OrderIntent, idempotencyKey: string): Promise<{
    orderId: string;
    status: "NEW" | "REJECTED";
    message?: string;
  }> {
    return this.client.placeOrder(order, idempotencyKey);
  }

  /** KIS REST API로 주문 취소 */
  public async cancelOrder(orderId: string): Promise<void> {
    await this.client.cancelOrder(orderId);
  }

  /** KIS REST API로 주문 정정 */
  public async amendOrder(orderId: string, qty: number, price?: number): Promise<void> {
    await this.client.amendOrder(orderId, qty, price);
  }

  /** KIS 당일 체결 조회 API로 sinceIso 이후 업데이트 폴링 */
  public async pullOrderUpdates(sinceIso: string): Promise<ExecutionUpdate[]> {
    return this.client.getOrderUpdates(sinceIso);
  }
}
