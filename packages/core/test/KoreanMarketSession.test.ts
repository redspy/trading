import { describe, expect, it } from "vitest";
import { KoreanMarketSession } from "../src/services/KoreanMarketSession.js";

describe("KoreanMarketSession", () => {
  const session = new KoreanMarketSession();

  function kstDate(dateStr: string, hhmm: number): Date {
    const h = Math.floor(hhmm / 100);
    const m = hhmm % 100;
    return new Date(
      `${dateStr}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+09:00`
    );
  }

  it("장 중(09:00-15:30)에 OPEN을 반환한다", () => {
    expect(session.getSession(kstDate("2026-03-23", 900))).toBe("OPEN");
    expect(session.getSession(kstDate("2026-03-23", 1200))).toBe("OPEN");
    expect(session.getSession(kstDate("2026-03-23", 1529))).toBe("OPEN");
  });

  it("장전 시간외(08:00-09:00)에 PRE_OPEN을 반환한다", () => {
    expect(session.getSession(kstDate("2026-03-23", 800))).toBe("PRE_OPEN");
    expect(session.getSession(kstDate("2026-03-23", 830))).toBe("PRE_OPEN");
    expect(session.getSession(kstDate("2026-03-23", 859))).toBe("PRE_OPEN");
  });

  it("장후 시간외(15:30-18:00)에 CLOSE를 반환한다", () => {
    expect(session.getSession(kstDate("2026-03-23", 1530))).toBe("CLOSE");
    expect(session.getSession(kstDate("2026-03-23", 1700))).toBe("CLOSE");
    expect(session.getSession(kstDate("2026-03-23", 1759))).toBe("CLOSE");
  });

  it("토요일에 AFTER_HOURS를 반환한다", () => {
    expect(session.getSession(kstDate("2026-03-21", 1000))).toBe("AFTER_HOURS");
  });

  it("일요일에 AFTER_HOURS를 반환한다", () => {
    expect(session.getSession(kstDate("2026-03-22", 1000))).toBe("AFTER_HOURS");
  });

  it("KRX 공휴일(삼일절)에 AFTER_HOURS를 반환한다", () => {
    expect(session.getSession(kstDate("2026-03-01", 1100))).toBe("AFTER_HOURS");
  });

  it("KRX 공휴일(광복절)에 AFTER_HOURS를 반환한다", () => {
    expect(session.getSession(kstDate("2026-08-15", 1200))).toBe("AFTER_HOURS");
  });

  it("자정 이전(00:00-08:00)에 AFTER_HOURS를 반환한다", () => {
    expect(session.getSession(kstDate("2026-03-23", 0))).toBe("AFTER_HOURS");
    expect(session.getSession(kstDate("2026-03-23", 700))).toBe("AFTER_HOURS");
    expect(session.getSession(kstDate("2026-03-23", 759))).toBe("AFTER_HOURS");
  });

  it("18:00 이후에 AFTER_HOURS를 반환한다", () => {
    expect(session.getSession(kstDate("2026-03-23", 1800))).toBe("AFTER_HOURS");
    expect(session.getSession(kstDate("2026-03-23", 2000))).toBe("AFTER_HOURS");
  });

  it("isOpen은 OPEN 세션에서만 true를 반환한다", () => {
    expect(session.isOpen(kstDate("2026-03-23", 1000))).toBe(true);
    expect(session.isOpen(kstDate("2026-03-23", 830))).toBe(false);
    expect(session.isOpen(kstDate("2026-03-23", 1600))).toBe(false);
    expect(session.isOpen(kstDate("2026-03-21", 1000))).toBe(false);
  });
});
