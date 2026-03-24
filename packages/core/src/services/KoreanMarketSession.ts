export type MarketSession = "PRE_OPEN" | "OPEN" | "CLOSE" | "AFTER_HOURS";

// KRX 휴장일 2026 (KST 기준 YYYY-MM-DD)
const KRX_HOLIDAYS_2026 = new Set([
  "2026-01-01", // 신정
  "2026-01-28", // 설날 연휴
  "2026-01-29", // 설날
  "2026-01-30", // 설날 연휴
  "2026-03-01", // 삼일절
  "2026-05-05", // 어린이날
  "2026-05-25", // 부처님오신날
  "2026-06-06", // 현충일
  "2026-08-15", // 광복절
  "2026-09-24", // 추석 연휴
  "2026-09-25", // 추석
  "2026-09-26", // 추석 연휴
  "2026-10-03", // 개천절
  "2026-10-09", // 한글날
  "2026-12-25"  // 크리스마스
]);

export class KoreanMarketSession {
  /**
   * 현재(혹은 지정한) 시각의 한국장 세션을 반환한다.
   * - OPEN        : 09:00–15:30 (장 중)
   * - PRE_OPEN    : 08:00–09:00 (장전 시간외)
   * - CLOSE       : 15:30–18:00 (장후 시간외)
   * - AFTER_HOURS : 그 외 (주말·공휴일 포함)
   */
  public getSession(now: Date = new Date()): MarketSession {
    // UTC+9 오프셋을 적용해 KST 기준 Date 생성
    const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
    const kst = new Date(kstMs);

    // 주말 판단 (0=일요일, 6=토요일)
    const dayOfWeek = kst.getUTCDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return "AFTER_HOURS";
    }

    // KRX 공휴일 판단
    const dateStr = kst.toISOString().slice(0, 10);
    if (KRX_HOLIDAYS_2026.has(dateStr)) {
      return "AFTER_HOURS";
    }

    const hhmm = kst.getUTCHours() * 100 + kst.getUTCMinutes();

    if (hhmm >= 900 && hhmm < 1530) return "OPEN";
    if (hhmm >= 800 && hhmm < 900) return "PRE_OPEN";
    if (hhmm >= 1530 && hhmm < 1800) return "CLOSE";
    return "AFTER_HOURS";
  }

  public isOpen(now: Date = new Date()): boolean {
    return this.getSession(now) === "OPEN";
  }
}
