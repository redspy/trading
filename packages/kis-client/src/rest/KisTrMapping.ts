// ─────────────────────────────────────────────────────────────
// KIS Open API TR(Transaction) 필드 매핑 유틸리티
//
// KIS API는 요청/응답에 KIS 전용 필드명을 사용하므로
// 내부 도메인 모델(OrderIntent, ExecutionUpdate 등)과의 변환을 이 파일에 집중한다.
//
// 참고 TR_ID:
//   주문:
//     TTTC0802U — 실거래 매수
//     TTTC0801U — 실거래 매도
//     VTTC0802U — 모의 매수
//     VTTC0801U — 모의 매도
//   체결 조회:
//     TTTC8001R — 실거래 당일 체결 조회
//     VTTC8001R — 모의 당일 체결 조회
//   시세:
//     FHKST01010100 — 주식 현재가 단건 조회
// ─────────────────────────────────────────────────────────────

import type { ExecutionUpdate, MarketEvent, OrderIntent } from "@trading/shared-domain";

/** 주문 방향과 모의/실거래 여부에 따른 TR_ID 선택 */
export function selectOrderTrId(side: "BUY" | "SELL", paperTrading: boolean): string {
  if (side === "BUY") return paperTrading ? "VTTC0802U" : "TTTC0802U";
  return paperTrading ? "VTTC0801U" : "TTTC0801U";
}

/**
 * OrderIntent를 KIS 주문 요청 바디로 변환한다.
 * ORD_DVSN: "00"=지정가, "01"=시장가
 * ORD_UNPR: LIMIT 주문 시 가격, MARKET 주문 시 "0"
 */
export function buildOrderBody(
  order: OrderIntent,
  cano: string,       // 계좌번호 앞 8자리
  acntPrdtCd: string  // 계좌상품코드 뒤 2자리
): Record<string, string> {
  return {
    CANO: cano,
    ACNT_PRDT_CD: acntPrdtCd,
    PDNO: order.symbol,
    ORD_DVSN: order.type === "LIMIT" ? "00" : "01",
    ORD_QTY: String(order.qty),
    ORD_UNPR: order.type === "LIMIT" && order.price !== undefined ? String(order.price) : "0"
  };
}

/**
 * KIS 주문 응답을 PlaceOrderResponse로 변환한다.
 * rt_cd == "0" → 성공, output.ODNO → 주문번호
 */
export function parseOrderResponse(body: unknown): {
  orderId: string;
  status: "NEW" | "REJECTED";
  message?: string;
} {
  const b = body as Record<string, unknown>;
  const output = (b.output ?? {}) as Record<string, unknown>;
  const success = b.rt_cd === "0";
  return {
    orderId: success ? String(output.ODNO ?? "") : "",
    status: success ? "NEW" : "REJECTED",
    ...(b.msg1 ? { message: String(b.msg1) } : {})
  };
}

/** 모의/실거래 여부에 따른 체결 조회 TR_ID 선택 */
export function selectCcldTrId(paperTrading: boolean): string {
  return paperTrading ? "VTTC8001R" : "TTTC8001R";
}

/**
 * 당일 체결 조회 쿼리 파라미터를 생성한다.
 * INQR_STRT_DT/END_DT: sinceIso~오늘 (YYYYMMDD 형식)
 * SLL_BUY_DVSN_CD: "00"=전체
 */
export function buildCcldQuery(
  cano: string,
  acntPrdtCd: string,
  sinceIso: string
): Record<string, string> {
  const start = sinceIso.slice(0, 10).replace(/-/g, "");
  const end = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return {
    CANO: cano,
    ACNT_PRDT_CD: acntPrdtCd,
    INQR_STRT_DT: start,
    INQR_END_DT: end,
    SLL_BUY_DVSN_CD: "00",
    INQR_DVSN: "00",
    PDNO: "",
    ORD_GNO_BRNO: "",
    ODNO: "",
    INQR_DVSN_3: "00",
    INQR_DVSN_1: "",
    CTX_AREA_FK100: "",
    CTX_AREA_NK100: ""
  };
}

/**
 * KIS 당일 체결 조회 응답(output1[])을 ExecutionUpdate 배열로 변환한다.
 *
 * 상태 매핑:
 *   RFUS_YN == "Y"                        → REJECTED
 *   TOT_CCLD_QTY >= ORD_QTY (전량 체결)  → FILLED
 *   TOT_CCLD_QTY > 0 (부분 체결)          → PARTIALLY_FILLED
 *   그 외                                  → NEW
 */
export function parseCcldResponse(body: unknown): ExecutionUpdate[] {
  const b = body as Record<string, unknown>;
  const output1 = (b.output1 ?? []) as Array<Record<string, unknown>>;
  return output1.map((item) => {
    const ordQty = Number(item.ORD_QTY ?? 0);
    const totCcldQty = Number(item.TOT_CCLD_QTY ?? 0);
    let status: ExecutionUpdate["status"];
    if (item.RFUS_YN === "Y") {
      status = "REJECTED";
    } else if (totCcldQty >= ordQty && ordQty > 0) {
      status = "FILLED";
    } else if (totCcldQty > 0) {
      status = "PARTIALLY_FILLED";
    } else {
      status = "NEW";
    }
    return {
      orderId: String(item.ODNO ?? ""),
      status,
      filledQty: totCcldQty,
      avgPrice: Number(item.AVG_PRVS ?? 0),
      ts: new Date().toISOString()
    };
  });
}

/** 주식 현재가 조회 쿼리 파라미터 생성 */
export function buildQuoteQuery(symbol: string): Record<string, string> {
  return { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: symbol };
}

/**
 * KIS 현재가 조회 응답을 MarketEvent로 변환한다.
 * STCK_PRPR: 현재가, ACML_VOL: 누적 거래량
 */
export function parseQuoteResponse(symbol: string, body: unknown): MarketEvent {
  const b = body as Record<string, unknown>;
  const output = (b.output ?? {}) as Record<string, unknown>;
  return {
    symbol,
    ts: new Date().toISOString(),
    price: Number(output.STCK_PRPR ?? 0),
    volume: Number(output.ACML_VOL ?? 0),
    source: "REST"
  };
}
