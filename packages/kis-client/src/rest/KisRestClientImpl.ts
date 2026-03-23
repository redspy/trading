import type { ExecutionUpdate, MarketEvent, OrderIntent } from "@trading/shared-domain";
import type {
  KisAuthToken,
  KisCredentials,
  KisRestClient,
  PlaceOrderResponse
} from "../types.js";

const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export class KisRestClientImpl implements KisRestClient {
  private token?: KisAuthToken;

  public constructor(private readonly credentials: KisCredentials) {}

  public async ensureAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) {
      return this.token.accessToken;
    }

    const response = await this.fetchWithRetry("/oauth2/tokenP", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
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

  public async placeOrder(order: OrderIntent, idempotencyKey: string): Promise<PlaceOrderResponse> {
    const accessToken = await this.ensureAccessToken();
    const response = await this.fetchWithRetry("/uapi/domestic-stock/v1/trading/order-cash", {
      method: "POST",
      headers: this.createAuthHeaders(accessToken, {
        "content-type": "application/json",
        "x-idempotency-key": idempotencyKey
      }),
      body: JSON.stringify({
        account_number: this.credentials.accountNumber,
        product_code: this.credentials.productCode,
        symbol: order.symbol,
        side: order.side,
        qty: order.qty,
        order_type: order.type,
        price: order.price,
        tif: order.tif,
        client_order_id: order.clientOrderId
      })
    });

    const payload = (await response.json()) as {
      order_id?: string;
      result_code?: string;
      message?: string;
    };

    return payload.message
      ? {
          orderId: payload.order_id ?? "",
          status: payload.result_code === "0" ? "NEW" : "REJECTED",
          message: payload.message
        }
      : {
          orderId: payload.order_id ?? "",
          status: payload.result_code === "0" ? "NEW" : "REJECTED"
        };
  }

  public async cancelOrder(orderId: string): Promise<void> {
    const accessToken = await this.ensureAccessToken();
    await this.fetchWithRetry("/uapi/domestic-stock/v1/trading/order-rvsecncl", {
      method: "POST",
      headers: this.createAuthHeaders(accessToken, { "content-type": "application/json" }),
      body: JSON.stringify({
        account_number: this.credentials.accountNumber,
        product_code: this.credentials.productCode,
        order_id: orderId,
        action: "CANCEL"
      })
    });
  }

  public async amendOrder(orderId: string, qty: number, price?: number): Promise<void> {
    const accessToken = await this.ensureAccessToken();
    await this.fetchWithRetry("/uapi/domestic-stock/v1/trading/order-rvsecncl", {
      method: "POST",
      headers: this.createAuthHeaders(accessToken, { "content-type": "application/json" }),
      body: JSON.stringify({
        account_number: this.credentials.accountNumber,
        product_code: this.credentials.productCode,
        order_id: orderId,
        action: "AMEND",
        qty,
        price
      })
    });
  }

  public async getOrderUpdates(sinceIso: string): Promise<ExecutionUpdate[]> {
    const accessToken = await this.ensureAccessToken();
    const response = await this.fetchWithRetry(
      `/uapi/domestic-stock/v1/trading/inquire-daily-ccld?since=${encodeURIComponent(sinceIso)}`,
      {
        method: "GET",
        headers: this.createAuthHeaders(accessToken)
      }
    );

    const payload = (await response.json()) as {
      data?: Array<{
        order_id: string;
        status: ExecutionUpdate["status"];
        filled_qty: number;
        avg_price: number;
        ts: string;
      }>;
    };

    return (payload.data ?? []).map((update) => ({
      orderId: update.order_id,
      status: update.status,
      filledQty: update.filled_qty,
      avgPrice: update.avg_price,
      ts: update.ts
    }));
  }

  public async getLatestQuote(symbol: string): Promise<MarketEvent> {
    const accessToken = await this.ensureAccessToken();
    const response = await this.fetchWithRetry(
      `/uapi/domestic-stock/v1/quotations/inquire-price?symbol=${encodeURIComponent(symbol)}`,
      {
        method: "GET",
        headers: this.createAuthHeaders(accessToken)
      }
    );

    const payload = (await response.json()) as {
      price: number;
      volume: number;
      ts: string;
    };

    return {
      symbol,
      ts: payload.ts,
      price: payload.price,
      volume: payload.volume,
      source: "REST"
    };
  }

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

  private createAuthHeaders(accessToken: string, extra: Record<string, string> = {}): Record<string, string> {
    return {
      authorization: `Bearer ${accessToken}`,
      appkey: this.credentials.appKey,
      appsecret: this.credentials.appSecret,
      ...extra
    };
  }

  private async backoff(attempt: number): Promise<void> {
    const baseMs = 250;
    const jitter = Math.floor(Math.random() * 150);
    const delay = Math.pow(2, attempt) * baseMs + jitter;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
