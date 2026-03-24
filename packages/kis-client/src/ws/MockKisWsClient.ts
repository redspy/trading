import type { ExecutionUpdate, MarketEvent } from "@trading/shared-domain";
import type { KisWsClient, KisRestClient } from "../types.js";
import type { KisWsCallbacks } from "./KisWsClientImpl.js";

export class MockKisWsClient implements KisWsClient {
  private symbols: string[] = [];
  private intervals: NodeJS.Timeout[] = [];

  public constructor(
    private readonly _credentials: unknown,
    private readonly _restClient: KisRestClient,
    private readonly callbacks: KisWsCallbacks
  ) {}

  public async start(symbols: string[]): Promise<void> {
    this.symbols = symbols;
    this.stopIntervals();

    for (const symbol of this.symbols) {
      const interval = setInterval(() => {
        const event: MarketEvent = {
          symbol,
          ts: new Date().toISOString(),
          price: 50000 + Math.floor(Math.random() * 2000) - 1000,
          volume: Math.floor(Math.random() * 10),
          source: "WS"
        };
        this.callbacks.onMarketEvent(event).catch(() => {});
      }, 1000 + Math.random() * 2000);
      this.intervals.push(interval);
    }
  }

  public async stop(): Promise<void> {
    this.stopIntervals();
  }

  private stopIntervals(): void {
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];
  }
}
