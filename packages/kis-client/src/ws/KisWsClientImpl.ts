import type { ExecutionUpdate, MarketEvent } from "@trading/shared-domain";
import WebSocket, { type RawData } from "ws";
import type { KisCredentials, KisRestClient, KisWsClient } from "../types.js";

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

  public constructor(
    private readonly credentials: KisCredentials,
    private readonly restClient: KisRestClient,
    private readonly callbacks: KisWsCallbacks
  ) {}

  public async start(symbols: string[]): Promise<void> {
    this.symbols = symbols;
    this.closedByUser = false;
    await this.connect();
  }

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
    const accessToken = await this.restClient.ensureAccessToken();

    this.ws = new WebSocket(this.credentials.wsUrl, {
      headers: {
        authorization: `Bearer ${accessToken}`,
        appkey: this.credentials.appKey,
        appsecret: this.credentials.appSecret
      }
    });

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
        await this.performRestFallbackSync();
        this.scheduleReconnect();
      }
    });

    this.ws.on("error", async (error: Error) => {
      await this.callbacks.onError?.(this.toError(error));
    });
  }

  private subscribeSymbols(): void {
    if (!this.ws) {
      return;
    }
    for (const symbol of this.symbols) {
      this.ws.send(
        JSON.stringify({
          type: "SUBSCRIBE",
          symbol
        })
      );
    }
  }

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

  private async handleMessage(raw: string): Promise<void> {
    const parsed = JSON.parse(raw) as {
      channel: "QUOTE" | "EXECUTION";
      symbol?: string;
      ts: string;
      price?: number;
      volume?: number;
      order_id?: string;
      status?: ExecutionUpdate["status"];
      filled_qty?: number;
      avg_price?: number;
    };

    if (parsed.channel === "QUOTE" && parsed.symbol && parsed.price !== undefined && parsed.volume !== undefined) {
      await this.callbacks.onMarketEvent({
        symbol: parsed.symbol,
        ts: parsed.ts,
        price: parsed.price,
        volume: parsed.volume,
        source: "WS"
      });
      return;
    }

    if (parsed.channel === "EXECUTION" && parsed.order_id && parsed.status) {
      await this.callbacks.onExecutionUpdate({
        orderId: parsed.order_id,
        status: parsed.status,
        filledQty: parsed.filled_qty ?? 0,
        avgPrice: parsed.avg_price ?? 0,
        ts: parsed.ts
      });
    }
  }

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
