// ─────────────────────────────────────────────────────────────
// KIS WebSocket 클라이언트 구현
//
// 주요 기능:
//   - approval_key 기반 WS 인증 및 종목 구독
//   - 실시간 시세(H0STCNT0) / 체결 통보(H0STCNI9) 파싱
//   - 하트비트 워치독: 5초마다 ping, 15초 무응답 시 강제 종료
//   - 자동 재연결: 단절 후 2초 대기 후 재연결 시도
//   - WS 단절 시 REST 폴백 동기화 (최근 60초 체결 + 종목 현재가)
//
// KIS WS 메시지 포맷:
//   - 제어 프레임 (구독 응답, 에러): JSON
//   - 데이터 프레임: "type|tr_id|count|field1^field2^..." (pipe/caret 구분)
//
// H0STCNT0 필드 인덱스 (실시간 체결):
//   [0]=종목코드, [1]=체결시각, [2]=현재가(STCK_PRPR), [11]=체결거래량(CNTG_VOL)
//
// H0STCNI9 필드 인덱스 (체결 통보):
//   [9]=주문번호(ODNO), [10]=체결수량(CNTG_QTY), [11]=체결단가(CNTG_UNPR),
//   [13]=체결여부(CNTG_YN: "1"=체결, "2"=부분체결)
// ─────────────────────────────────────────────────────────────

import type { ExecutionUpdate, MarketEvent } from "@trading/shared-domain";
import WebSocket, { type RawData } from "ws";
import type { KisCredentials, KisRestClient, KisWsClient } from "../types.js";

/** KIS WS 이벤트 콜백 인터페이스 */
export interface KisWsCallbacks {
  onMarketEvent: (event: MarketEvent) => Promise<void>;
  onExecutionUpdate: (event: ExecutionUpdate) => Promise<void>;
  onError?: (error: Error) => Promise<void>;
}

export class KisWsClientImpl implements KisWsClient {
  private ws?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeatTimer?: NodeJS.Timeout;
  private symbols: string[] = [];
  private closedByUser = false;
  private approvalKey = ""; // WS 구독 인증키 (연결마다 갱신)

  public constructor(
    private readonly credentials: KisCredentials,
    private readonly restClient: KisRestClient,
    private readonly callbacks: KisWsCallbacks
  ) {}

  /** 종목 구독을 시작하고 WS 연결을 초기화한다 */
  public async start(symbols: string[]): Promise<void> {
    this.symbols = symbols;
    this.closedByUser = false;
    await this.connect();
  }

  /** WS 연결을 정상 종료한다 (재연결 타이머도 취소) */
  public async stop(): Promise<void> {
    this.closedByUser = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    this.ws?.close();
  }

  private async connect(): Promise<void> {
    // 연결마다 approval_key를 새로 발급받는다
    this.approvalKey = await this.restClient.getApprovalKey();

    this.ws = new WebSocket(this.credentials.wsUrl);

    this.ws.on("open", () => {
      this.subscribeSymbols();
      this.startHeartbeatWatchdog();
    });

    this.ws.on("message", async (data: RawData) => {
      try {
        await this.handleMessage(data.toString());
      } catch (error) {
        await this.callbacks.onError?.(this.toError(error));
      }
    });

    this.ws.on("close", async () => {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
      }
      if (!this.closedByUser) {
        // 단절 시 REST 폴백으로 누락 데이터 보완 후 재연결
        await this.performRestFallbackSync();
        this.scheduleReconnect();
      }
    });

    this.ws.on("error", async (error: Error) => {
      await this.callbacks.onError?.(this.toError(error));
    });
  }

  /**
   * KIS WS 종목 구독 메시지 전송.
   * approval_key + H0STCNT0 tr_id + tr_key(종목코드) 형식
   */
  private subscribeSymbols(): void {
    if (!this.ws) {
      return;
    }
    for (const symbol of this.symbols) {
      this.ws.send(
        JSON.stringify({
          header: {
            approval_key: this.approvalKey,
            custtype: "P",
            tr_type: "1",          // "1"=구독 등록
            "content-type": "utf-8"
          },
          body: { input: { tr_id: "H0STCNT0", tr_key: symbol } }
        })
      );
    }
  }

  /**
   * 하트비트 워치독: 5초마다 ping을 보내고
   * 마지막 pong으로부터 15초 이상 경과하면 연결을 강제 종료한다.
   */
  private startHeartbeatWatchdog(): void {
    const ws = this.ws;
    if (!ws) {
      return;
    }

    let lastPong = Date.now();

    ws.on("pong", () => {
      lastPong = Date.now();
    });

    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - lastPong > 15_000) {
        ws.terminate();
        return;
      }
      ws.ping();
    }, 5_000);
  }

  /**
   * KIS WS 메시지를 파싱하고 콜백을 호출한다.
   *
   * KIS는 두 가지 메시지 포맷을 사용한다:
   *   - JSON: 제어 메시지 (구독 확인, 에러) → 무시
   *   - pipe-delimited: 실데이터 "type|tr_id|count|data"
   *     data는 "^" 구분 필드 배열
   */
  private async handleMessage(raw: string): Promise<void> {
    // JSON 제어 프레임 무시
    if (raw.startsWith("{")) {
      return;
    }

    const parts = raw.split("|");
    // parts[0]=type, parts[1]=tr_id, parts[2]=count, parts[3]=data
    if (parts.length < 4) {
      return;
    }

    const trId = parts[1];
    const dataStr = parts[3] ?? "";
    const fields = dataStr.split("^");

    if (trId === "H0STCNT0") {
      // 실시간 체결: [0]=종목코드, [2]=현재가, [11]=체결거래량
      await this.callbacks.onMarketEvent({
        symbol: fields[0] ?? "",
        ts: new Date().toISOString(),
        price: Number(fields[2] ?? 0),
        volume: Number(fields[11] ?? 0),
        source: "WS"
      });
      return;
    }

    if (trId === "H0STCNI9") {
      // 체결 통보: [9]=주문번호, [10]=체결수량, [11]=체결단가, [13]=체결여부
      // CNTG_YN: "1"=전량체결, "2"=부분체결, 그 외=미체결
      const cntgYn = fields[13] ?? "";
      const status: ExecutionUpdate["status"] =
        cntgYn === "1" ? "FILLED" : cntgYn === "2" ? "PARTIALLY_FILLED" : "NEW";
      await this.callbacks.onExecutionUpdate({
        orderId: fields[9] ?? "",
        status,
        filledQty: Number(fields[10] ?? 0),
        avgPrice: Number(fields[11] ?? 0),
        ts: new Date().toISOString()
      });
    }
  }

  /**
   * WS 단절 시 REST API로 누락 데이터를 보완한다.
   * - 최근 60초 체결 업데이트 조회
   * - 각 워치리스트 종목 현재가 조회 (mark price 갱신용)
   */
  private async performRestFallbackSync(): Promise<void> {
    const updates = await this.restClient.getOrderUpdates(new Date(Date.now() - 60_000).toISOString());
    for (const update of updates) {
      await this.callbacks.onExecutionUpdate(update);
    }

    for (const symbol of this.symbols) {
      const quote = await this.restClient.getLatestQuote(symbol);
      await this.callbacks.onMarketEvent({ ...quote, source: "REST" });
    }
  }

  /** 2초 후 재연결 시도. 재연결 실패 시 재귀적으로 스케줄링 */
  private scheduleReconnect(): void {
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(async (error) => {
        await this.callbacks.onError?.(this.toError(error));
        this.scheduleReconnect();
      });
    }, 2_000);
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }
}
