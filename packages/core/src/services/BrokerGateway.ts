// ─────────────────────────────────────────────────────────────
// 브로커 게이트웨이 인터페이스
// 실거래(KisBrokerGateway)와 모의거래(PaperBrokerGateway)가
// 이 인터페이스를 구현한다. ExecutionService는 이 인터페이스만 의존한다.
// ─────────────────────────────────────────────────────────────

import type { ExecutionUpdate, OrderIntent } from "@trading/shared-domain";

export interface BrokerGateway {
  /** 주문 접수. idempotencyKey로 KIS 서버 측 중복 방지 */
  placeOrder(order: OrderIntent, idempotencyKey: string): Promise<{
    orderId: string;
    status: "NEW" | "REJECTED";
    message?: string;
  }>;

  /** 주문 취소 */
  cancelOrder(orderId: string): Promise<void>;

  /** 주문 정정 (수량/가격 변경) */
  amendOrder(orderId: string, qty: number, price?: number): Promise<void>;

  /** sinceIso 이후의 체결 업데이트를 브로커에서 폴링 */
  pullOrderUpdates(sinceIso: string): Promise<ExecutionUpdate[]>;
}
