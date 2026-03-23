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

  public async placeOrder(input: OrderIntent): Promise<OrderRecord> {
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

    if (this.options.liveMode && this.options.paperMode) {
      throw new AppError(
        ErrorCode.LIVE_MODE_BLOCKED,
        "PAPER_MODE and LIVE_MODE cannot be enabled together for execution safety"
      );
    }

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

  public onExecutionUpdate(update: ExecutionUpdate): void {
    const order = this.orderRepo.findById(update.orderId);
    if (!order) {
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

  public getOrder(id: string): OrderRecord {
    const order = this.orderRepo.findById(id);
    if (!order) {
      throw new AppError(ErrorCode.ORDER_NOT_FOUND, "Order not found", { orderId: id });
    }
    return order;
  }

  public async syncOrderUpdates(sinceIso: string): Promise<number> {
    const updates = await this.brokerGateway.pullOrderUpdates(sinceIso);
    for (const update of updates) {
      this.onExecutionUpdate(update);
    }
    return updates.length;
  }
}
