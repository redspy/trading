import type { JournalRepo } from "../repo/interfaces.js";

export class TradeJournalService {
  public constructor(private readonly repo: JournalRepo) {}

  public log(category: string, payload: unknown): void {
    this.repo.append(category, payload);
  }
}
