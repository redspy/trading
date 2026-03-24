// ─────────────────────────────────────────────────────────────
// KIS REST API 클라이언트 구현
//
// 주요 기능:
//   - OAuth2 액세스 토큰 자동 갱신 (만료 30초 전 갱신)
//   - WebSocket 구독용 approval_key 취득
//   - 주문/취소/정정/체결조회/현재가 조회
//   - 지수 백오프 재시도 (408, 429, 5xx)
//
// KIS API 헤더 공통 필드:
//   authorization: Bearer {token}
//   appkey / appsecret: 앱 인증
//   custtype: "P" (개인)
//   tr_id: 각 TR별 고유 식별자
// ─────────────────────────────────────────────────────────────

import type { ExecutionUpdate, MarketEvent, OrderIntent } from "@trading/shared-domain";
import type { KisAuthToken, KisCredentials, KisRestClient, PlaceOrderResponse } from "../types.js";
import {
  buildCcldQuery,
  buildOrderBody,
  buildQuoteQuery,
  parseCcldResponse,
  parseOrderResponse,
  parseQuoteResponse,
  selectCcldTrId,
  selectOrderTrId
} from "./KisTrMapping.js";

/** 재시도 대상 HTTP 상태 코드 */
const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export class KisRestClientImpl implements KisRestClient {
  private token?: KisAuthToken;

  public constructor(private readonly credentials: KisCredentials) {}

  /**
   * 유효한 액세스 토큰을 반환한다.
   * 토큰이 없거나 만료 30초 전이면 자동으로 재발급한다.
   */
  public async ensureAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) {
      return this.token.accessToken;
    }

    const response = await this.fetchWithRetry("/oauth2/tokenP", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        appkey: this.credentials.appKey,
        appsecret: this.credentials.appSecret
      })
    });

    const payload = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    this.token = {
      accessToken: payload.access_token,
      expiresAt: Date.now() + payload.expires_in * 1000
    };

    return this.token.accessToken;
  }

  /**
   * KIS WebSocket 구독에 필요한 approval_key를 발급받는다.
   * 액세스 토큰과 별도로 관리되며, WS 연결마다 새로 발급한다.
   */
  public async getApprovalKey(): Promise<string> {
    const response = await this.fetchWithRetry("/oauth2/Approval", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        appkey: this.credentials.appKey,
        secretkey: this.credentials.appSecret
      })
    });
    const payload = (await response.json()) as { approval_key: string };
    return payload.approval_key;
  }

  /**
   * 주문을 KIS에 접수한다.
   * tr_id: 매수/매도 × 모의/실거래 조합으로 선택 (KisTrMapping.selectOrderTrId)
   * idempotencyKey: KIS 서버 측 중복 주문 방지 키
   */
  public async placeOrder(order: OrderIntent, idempotencyKey: string): Promise<PlaceOrderResponse> {
    const accessToken = await this.ensureAccessToken();
    const cano = this.credentials.accountNumber.slice(0, 8);
    const acntPrdtCd = this.credentials.productCode;
    const trId = selectOrderTrId(order.side, this.credentials.paperTrading);

    const response = await this.fetchWithRetry("/uapi/domestic-stock/v1/trading/order-cash", {
      method: "POST",
      headers: this.createAuthHeaders(accessToken, {
        "content-type": "application/json",
        tr_id: trId,
        "x-idempotency-key": idempotencyKey
      }),
      body: JSON.stringify(buildOrderBody(order, cano, acntPrdtCd))
    });

    return parseOrderResponse(await response.json());
  }

  /**
   * 주문을 취소한다.
   * order-rvsecncl TR, RVSE_CNCL_DVSN_CD="02"(취소), QTY_ALL_ORD_YN="Y"(전량)
   */
  public async cancelOrder(orderId: string): Promise<void> {
    const accessToken = await this.ensureAccessToken();
    const cano = this.credentials.accountNumber.slice(0, 8);
    const trId = this.credentials.paperTrading ? "VTTC0803U" : "TTTC0803U";
    await this.fetchWithRetry("/uapi/domestic-stock/v1/trading/order-rvsecncl", {
      method: "POST",
      headers: this.createAuthHeaders(accessToken, {
        "content-type": "application/json",
        tr_id: trId
      }),
      body: JSON.stringify({
        CANO: cano,
        ACNT_PRDT_CD: this.credentials.productCode,
        KRX_FWDG_ORD_ORGNO: "",
        ORGN_ODNO: orderId,
        ORD_DVSN: "00",
        RVSE_CNCL_DVSN_CD: "02", // 취소
        ORD_QTY: "0",
        ORD_UNPR: "0",
        QTY_ALL_ORD_YN: "Y"      // 전량 취소
      })
    });
  }

  /**
   * 주문을 정정한다.
   * order-rvsecncl TR, RVSE_CNCL_DVSN_CD="01"(정정)
   * price가 없으면 시장가(ORD_DVSN="01"), 있으면 지정가(ORD_DVSN="00")
   */
  public async amendOrder(orderId: string, qty: number, price?: number): Promise<void> {
    const accessToken = await this.ensureAccessToken();
    const cano = this.credentials.accountNumber.slice(0, 8);
    const trId = this.credentials.paperTrading ? "VTTC0803U" : "TTTC0803U";
    await this.fetchWithRetry("/uapi/domestic-stock/v1/trading/order-rvsecncl", {
      method: "POST",
      headers: this.createAuthHeaders(accessToken, {
        "content-type": "application/json",
        tr_id: trId
      }),
      body: JSON.stringify({
        CANO: cano,
        ACNT_PRDT_CD: this.credentials.productCode,
        KRX_FWDG_ORD_ORGNO: "",
        ORGN_ODNO: orderId,
        ORD_DVSN: price !== undefined ? "00" : "01",
        RVSE_CNCL_DVSN_CD: "01", // 정정
        ORD_QTY: String(qty),
        ORD_UNPR: price !== undefined ? String(price) : "0",
        QTY_ALL_ORD_YN: "N"
      })
    });
  }

  /**
   * sinceIso 이후 당일 체결 내역을 조회한다.
   * inquire-daily-ccld TR (TTTC8001R/VTTC8001R)
   */
  public async getOrderUpdates(sinceIso: string): Promise<ExecutionUpdate[]> {
    const accessToken = await this.ensureAccessToken();
    const cano = this.credentials.accountNumber.slice(0, 8);
    const acntPrdtCd = this.credentials.productCode;
    const trId = selectCcldTrId(this.credentials.paperTrading);
    const params = new URLSearchParams(buildCcldQuery(cano, acntPrdtCd, sinceIso));

    const response = await this.fetchWithRetry(
      `/uapi/domestic-stock/v1/trading/inquire-daily-ccld?${params.toString()}`,
      {
        method: "GET",
        headers: this.createAuthHeaders(accessToken, { tr_id: trId })
      }
    );

    return parseCcldResponse(await response.json());
  }

  /**
   * 종목의 현재가를 단건 조회한다.
   * inquire-price TR (FHKST01010100)
   * WS 단절 시 REST 폴백 동기화에 사용된다.
   */
  public async getLatestQuote(symbol: string): Promise<MarketEvent> {
    const accessToken = await this.ensureAccessToken();
    const params = new URLSearchParams(buildQuoteQuery(symbol));

    const response = await this.fetchWithRetry(
      `/uapi/domestic-stock/v1/quotations/inquire-price?${params.toString()}`,
      {
        method: "GET",
        headers: this.createAuthHeaders(accessToken, { tr_id: "FHKST01010100" })
      }
    );

    return parseQuoteResponse(symbol, await response.json());
  }

  /**
   * 지수 백오프 재시도 포함 HTTP 요청.
   * RETRY_STATUS(408, 429, 5xx) 응답 시 최대 maxRetries회 재시도.
   * 네트워크 오류도 재시도 대상이다.
   */
  private async fetchWithRetry(path: string, init: RequestInit, maxRetries = 3): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await fetch(`${this.credentials.baseUrl}${path}`, init);
        if (!response.ok && RETRY_STATUS.has(response.status) && attempt < maxRetries) {
          await this.backoff(attempt);
          continue;
        }
        if (!response.ok) {
          const body = await response.text();
          throw new Error(`KIS REST error(${response.status}): ${body}`);
        }
        return response;
      } catch (error) {
        lastError = error;
        if (attempt === maxRetries) {
          break;
        }
        await this.backoff(attempt);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Unknown KIS REST error");
  }

  /** KIS 공통 인증 헤더 생성 */
  private createAuthHeaders(accessToken: string, extra: Record<string, string> = {}): Record<string, string> {
    return {
      authorization: `Bearer ${accessToken}`,
      appkey: this.credentials.appKey,
      appsecret: this.credentials.appSecret,
      custtype: "P", // 개인 투자자
      ...extra
    };
  }

  /** 지수 백오프 대기: 250ms × 2^attempt + 랜덤 지터(최대 150ms) */
  private async backoff(attempt: number): Promise<void> {
    const baseMs = 250;
    const jitter = Math.floor(Math.random() * 150);
    const delay = Math.pow(2, attempt) * baseMs + jitter;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
