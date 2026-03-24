// ─────────────────────────────────────────────────────────────
// 거래 저널 서비스
// 주문 접수·체결 등 모든 의사결정 이벤트를 journal_logs 테이블에
// 구조화 JSON으로 기록한다. 사후 분석 및 감사 추적에 사용된다.
// ─────────────────────────────────────────────────────────────

import type { JournalRepo } from "../repo/interfaces.js";

export class TradeJournalService {
  public constructor(private readonly repo: JournalRepo) {}

  /** category 분류와 함께 payload를 저널에 기록 */
  public log(category: string, payload: unknown): void {
    this.repo.append(category, payload);
  }
}
