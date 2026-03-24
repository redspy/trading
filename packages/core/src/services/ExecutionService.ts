// ─────────────────────────────────────────────────────────────
// 집행 서비스 (주문 생명주기 관리)
//
// 주요 책임:
//   - placeOrder: 멱등성 키(clientOrderId) 검증 후 브로커에 주문 전달
//   - onExecutionUpdate: 체결 이벤트 수신 → 상태 전이 검증 → DB 반영
//   - syncOrderUpdates: 브로커 폴링으로 누락된 체결 이벤트 복구
//
// 안전 장치:
//   - clientOrderId 중복 방지 (중복 접수 시 ORDER_ALREADY_EXISTS)
//   - 킬스위치 체크
//   - PAPER_MODE / LIVE_MODE 배타적 검증
// ─────────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";
import type { ExecutionUpdate, OrderIntent, OrderRecord } from "@trading/shared-domain";
import { AppError, ErrorCode } from "../errors/AppError.js";
import type { EventRepo, JournalRepo, OrderRepo } from "../repo/interfaces.js";
import { assertOrderTransition } from "./OrderStateMachine.js";
import type { BrokerGateway } from "./BrokerGateway.js";
import type { RuntimeFlags } from "./RuntimeFlags.js";

export interface ExecutionServiceOptions {
  paperMode: boolean;
  liveMode: boolean;
}

export class ExecutionService {
  public constructor(
    private readonly orderRepo: OrderRepo,
    private readonly eventRepo: EventRepo,
    private readonly journalRepo: JournalRepo,
    private readonly brokerGateway: BrokerGateway,
    private readonly runtimeFlags: RuntimeFlags,
    private readonly options: ExecutionServiceOptions
  ) {}

  /**
   * 새 주문을 브로커에 접수하고 DB에 기록한다.
   * clientOrderId가 이미 존재하면 ORDER_ALREADY_EXISTS를 던진다.
   */
  public async placeOrder(input: OrderIntent): Promise<OrderRecord> {
    // 중복 주문 방지: clientOrderId 사전 확인
    const existing = this.orderRepo.findByClientOrderId(input.clientOrderId);
    if (existing) {
      throw new AppError(ErrorCode.ORDER_ALREADY_EXISTS, "clientOrderId already exists", {
        clientOrderId: input.clientOrderId
      });
    }

    if (this.runtimeFlags.isKillSwitchEnabled()) {
      throw new AppError(ErrorCode.KILL_SWITCH_ACTIVE, "Kill switch is active");
    }

    if (!this.options.paperMode && !this.options.liveMode) {
      throw new AppError(ErrorCode.LIVE_MODE_BLOCKED, "No execution mode configured");
    }

    // PAPER_MODE와 LIVE_MODE 동시 활성화는 운영 안전 사고 방지를 위해 차단
    if (this.options.liveMode && this.options.paperMode) {
      throw new AppError(
        ErrorCode.LIVE_MODE_BLOCKED,
        "PAPER_MODE and LIVE_MODE cannot be enabled together for execution safety"
      );
    }

    // KIS 서버 측 멱등성 키: clientOrderId + 랜덤 UUID 조합
    const idempotencyKey = `${input.clientOrderId}:${randomUUID()}`;
    const brokerResult = await this.brokerGateway.placeOrder(input, idempotencyKey);
    const now = new Date().toISOString();

    const order: OrderRecord = {
      ...input,
      id: brokerResult.orderId || randomUUID(),
      status: brokerResult.status,
      filledQty: 0,
      avgPrice: 0,
      createdAt: now,
      updatedAt: now
    };

    this.orderRepo.create(order);
    this.eventRepo.insertSystemEvent("ORDER_SUBMITTED", "Order submitted", {
      orderId: order.id,
      symbol: order.symbol,
      clientOrderId: order.clientOrderId
    });
    this.journalRepo.append("order.submitted", order, now);

    return order;
  }

  /**
   * 체결 업데이트를 처리한다.
   * 알 수 없는 orderId는 고아 이벤트로 기록하고 무시한다.
   * 상태 전이 규칙 위반 시 INVALID_ORDER_TRANSITION을 던진다.
   */
  public onExecutionUpdate(update: ExecutionUpdate): void {
    const order = this.orderRepo.findById(update.orderId);
    if (!order) {
      // KIS WS에서 수신했으나 내부 주문 레코드가 없는 경우 (재연결 후 오래된 이벤트 등)
      this.eventRepo.insertSystemEvent("ORDER_UPDATE_ORPHAN", "Received execution update for unknown order", {
        orderId: update.orderId,
        status: update.status
      });
      return;
    }

    assertOrderTransition(order.status, update.status);
    this.orderRepo.updateExecution(update);
    this.journalRepo.append("order.execution_update", update, update.ts);
  }

  /** orderId로 주문 레코드를 조회한다 */
  public getOrder(id: string): OrderRecord {
    const order = this.orderRepo.findById(id);
    if (!order) {
      throw new AppError(ErrorCode.ORDER_NOT_FOUND, "Order not found", { orderId: id });
    }
    return order;
  }

  /**
   * 브로커 폴링으로 sinceIso 이후 체결 업데이트를 가져와 적용한다.
   * WS 단절 시 누락된 체결 이벤트를 복구하는 용도로도 사용된다.
   */
  public async syncOrderUpdates(sinceIso: string): Promise<number> {
    const updates = await this.brokerGateway.pullOrderUpdates(sinceIso);
    for (const update of updates) {
      this.onExecutionUpdate(update);
    }
    return updates.length;
  }
}
