// ─────────────────────────────────────────────────────────────
// 리포지토리 인터페이스 정의
// SqliteRepositories가 모든 인터페이스를 구현한다.
// 테스트에서는 InMemoryRepos로 대체한다.
// ─────────────────────────────────────────────────────────────

import type {
  DailyPnl,
  ExecutionUpdate,
  MarketEvent,
  OrderRecord,
  Position,
  RiskDecision,
  Side,
  TradeSignal
} from "@trading/shared-domain";

/** 주문 CRUD 및 활성 주문 조회 */
export interface OrderRepo {
  create(order: OrderRecord): void;
  findById(id: string): OrderRecord | undefined;
  findByClientOrderId(clientOrderId: string): OrderRecord | undefined;
  /** 동일 심볼/방향의 NEW/PARTIALLY_FILLED 주문 존재 여부 */
  hasActiveOrder(symbol: string, side: Side): boolean;
  updateExecution(update: ExecutionUpdate): void;
  listOpenOrders(): OrderRecord[];
}

/** 포지션 관리 및 손익 계산 */
export interface PositionRepo {
  /** 체결 이벤트를 포지션에 반영하고 손익을 갱신한다 */
  applyFill(input: {
    orderId: string;
    symbol: string;
    side: Side;
    qty: number;
    price: number;
    ts: string;
  }): void;
  /** 현재가 기준으로 미실현 손익을 갱신한다 */
  updateMarkPrice(symbol: string, lastPrice: number): void;
  list(): Position[];
  getDailyPnl(date: string): DailyPnl;
}

/** 거래 저널 추가 전용 인터페이스 */
export interface JournalRepo {
  append(category: string, payload: unknown, ts?: string): void;
}

/** 이벤트/신호/결정 기록 인터페이스 */
export interface EventRepo {
  insertMarketEvent(event: MarketEvent): void;
  insertSignal(signal: TradeSignal): void;
  insertRiskDecision(symbol: string, decision: RiskDecision, ts: string): void;
  insertSystemEvent(category: string, message: string, metadata?: unknown): void;
}
