// ─────────────────────────────────────────────────────────────
// KIS 클라이언트 타입 정의
//
// KisRestClient 인터페이스를 통해 실구현(KisRestClientImpl)과
// 테스트 목(Mock)을 교체할 수 있다.
// ─────────────────────────────────────────────────────────────

import type { ExecutionUpdate, MarketEvent, OrderIntent } from "@trading/shared-domain";

/** KIS OAuth2 액세스 토큰 */
export interface KisAuthToken {
  accessToken: string;
  expiresAt: number; // Unix milliseconds
}

/** KIS API 인증 자격증명 */
export interface KisCredentials {
  appKey: string;
  appSecret: string;
  accountNumber: string; // 전체 계좌번호 (CANO 8자리 + 상품코드 2자리)
  productCode: string;   // 계좌상품코드 (예: "01")
  paperTrading: boolean; // true: 모의투자 TR_ID 사용
  baseUrl: string;       // REST API 베이스 URL
  wsUrl: string;         // WebSocket URL
}

/** placeOrder 응답 */
export interface PlaceOrderResponse {
  orderId: string;
  status: "NEW" | "REJECTED";
  message?: string;
}

/** KIS REST API 클라이언트 인터페이스 */
export interface KisRestClient {
  /** OAuth2 액세스 토큰 취득 (캐시/자동 갱신) */
  ensureAccessToken(): Promise<string>;
  /** WebSocket 구독용 approval_key 취득 */
  getApprovalKey(): Promise<string>;
  placeOrder(order: OrderIntent, idempotencyKey: string): Promise<PlaceOrderResponse>;
  cancelOrder(orderId: string): Promise<void>;
  amendOrder(orderId: string, qty: number, price?: number): Promise<void>;
  /** sinceIso 이후 체결 업데이트 조회 (inquire-daily-ccld TR) */
  getOrderUpdates(sinceIso: string): Promise<ExecutionUpdate[]>;
  /** 종목 현재가 단건 조회 (inquire-price TR) */
  getLatestQuote(symbol: string): Promise<MarketEvent>;
}

/** KIS WebSocket 클라이언트 인터페이스 */
export interface KisWsClient {
  /** 주어진 종목코드 목록 구독 시작 */
  start(symbols: string[]): Promise<void>;
  /** WebSocket 연결 종료 */
  stop(): Promise<void>;
}
