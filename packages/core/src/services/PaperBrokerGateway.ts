// ─────────────────────────────────────────────────────────────
// 모의거래 브로커 게이트웨이 (Paper Trading)
// PAPER_MODE=true 일 때 KIS 대신 사용된다.
// placeOrder 즉시 FILLED 상태로 체결 업데이트를 큐에 쌓고,
// pullOrderUpdates 시 반환한다.
//
// 주의: 모의 체결이므로 실제 슬리피지·호가 등은 반영되지 않는다.
// ─────────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";
import type { ExecutionUpdate, OrderIntent } from "@trading/shared-domain";
import type { BrokerGateway } from "./BrokerGateway.js";

export class PaperBrokerGateway implements BrokerGateway {
  // 모의 체결 이벤트 큐 (pullOrderUpdates가 반환한다)
  private readonly updates: ExecutionUpdate[] = [];

  public async placeOrder(order: OrderIntent): Promise<{ orderId: string; status: "NEW" | "REJECTED" }> {
    const orderId = randomUUID();
    const ts = new Date().toISOString();
    // 즉시 전량 체결로 시뮬레이션
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
    // 모의 환경에서는 취소 즉시 성공 처리
    return;
  }

  public async amendOrder(_orderId: string, _qty: number, _price?: number): Promise<void> {
    // 모의 환경에서는 정정 즉시 성공 처리
    return;
  }

  /** sinceIso 이후에 쌓인 모의 체결 이벤트를 반환 */
  public async pullOrderUpdates(sinceIso: string): Promise<ExecutionUpdate[]> {
    const sinceMs = Date.parse(sinceIso);
    return this.updates.filter((update) => Date.parse(update.ts) >= sinceMs);
  }
}
