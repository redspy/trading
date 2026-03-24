// ─────────────────────────────────────────────────────────────
// 공유 도메인 타입 정의
// 모든 패키지(core, collector, kis-client)가 공통으로 사용하는
// 핵심 도메인 모델을 정의한다.
// ─────────────────────────────────────────────────────────────

/** 주문 방향 */
export type Side = "BUY" | "SELL";

/** 시세 데이터 출처 */
export type MarketSource = "WS" | "REST";

/** 실시간 시세 이벤트 (틱 단위) */
export interface MarketEvent {
  symbol: string;   // 종목코드 (예: "005930")
  ts: string;       // ISO-8601 타임스탬프
  price: number;    // 현재가
  volume: number;   // 체결 거래량
  source: MarketSource;
}

/** 전략 엔진이 생성하는 매매 신호 */
export interface TradeSignal {
  symbol: string;
  side: Side;
  reason: string;    // 신호 발생 사유 (로그/감사용)
  confidence: number; // 신뢰도 0~1
  ts: string;
}

/** 리스크 매니저의 주문 허용/차단 결정 */
export interface RiskDecision {
  allow: boolean;
  ruleHits: string[]; // 위반된 리스크 규칙 목록
  maxQty: number;     // 허용 최대 수량 (리스크 예산 기반)
}

/** 주문 유형 */
export type OrderType = "MARKET" | "LIMIT";

/** 주문 유효 시간 조건 */
export type TimeInForce = "DAY" | "IOC" | "FOK";

/** 브로커에 전달할 주문 의도 */
export interface OrderIntent {
  symbol: string;
  side: Side;
  qty: number;
  type: OrderType;
  price?: number;       // LIMIT 주문 시에만 사용
  tif: TimeInForce;
  clientOrderId: string; // 멱등성 키 (중복 주문 방지)
}

/** 주문 체결 상태 */
export type ExecutionStatus =
  | "NEW"             // 접수
  | "PARTIALLY_FILLED" // 부분 체결
  | "FILLED"          // 완전 체결
  | "CANCELED"        // 취소
  | "REJECTED";       // 거부

/** 브로커/KIS로부터 수신하는 체결 업데이트 */
export interface ExecutionUpdate {
  orderId: string;
  status: ExecutionStatus;
  filledQty: number;  // 누적 체결 수량
  avgPrice: number;   // 평균 체결 단가
  ts: string;
}

/** 현재 보유 포지션 */
export interface Position {
  symbol: string;
  qty: number;
  avgPrice: number;       // 평균 매입 단가
  unrealizedPnl: number;  // 미실현 손익
  realizedPnl: number;    // 실현 손익
}

/** 일자별 손익 집계 */
export interface DailyPnl {
  date: string;            // YYYY-MM-DD
  realizedPnl: number;     // 실현 손익 합계
  unrealizedPnl: number;   // 미실현 손익 합계 (전 포지션)
  totalPnl: number;        // 총 손익
}

/** 데이터베이스에 저장되는 주문 레코드 */
export interface OrderRecord extends OrderIntent {
  id: string;            // 브로커 주문번호 (또는 내부 UUID)
  status: ExecutionStatus;
  filledQty: number;
  avgPrice: number;
  createdAt: string;
  updatedAt: string;
}
