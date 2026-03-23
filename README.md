# trading

KIS Open API 기반 국내주식 개인 자동매매 서버/수집기 모노레포입니다.

## 현재 상태 (2026-03-23)
- 모노레포 구조 구성 완료: `core`, `collector`, `shared-domain`, `kis-client`
- Core 내부 API 구현 완료:
  - `GET /health`
  - `POST /internal/market-events`
  - `POST /internal/orders`
  - `POST /internal/execution-updates`
  - `POST /internal/killswitch/enable|disable`
  - `GET /internal/positions`
  - `GET /internal/pnl`
  - `GET /internal/orders/:id`
- SQLite 기반 저장소/마이그레이션/리포지토리 추상화 구성 완료
- 전략/리스크/집행/포지션 계산/저널링의 기본 플로우 구현 완료
- KIS REST/WS 클라이언트 초안 구현 완료 (토큰 갱신, 재시도, WS 재연결, REST 폴백)
- 테스트 상태:
  - 단위 테스트 통과
  - 통합 테스트는 샌드박스 환경에서 소켓 제한으로 기본 skip

## 구성
- `@trading/core`: 전략/리스크/집행/포트폴리오/저널 API 서버
- `@trading/collector`: KIS WebSocket 수집기 (core 내부 API로 이벤트 전달)
- `@trading/shared-domain`: 공통 타입/스키마
- `@trading/kis-client`: KIS REST/WS 클라이언트

## 빠른 시작
```bash
cp .env.example .env
npm install
npm run dev:core
npm run dev:collector
```

## 내부 API
- `GET /health`
- `POST /internal/market-events`
- `POST /internal/orders`
- `POST /internal/killswitch/enable|disable`
- `GET /internal/positions`
- `GET /internal/pnl`
- `GET /internal/orders/:id`

요청 시 헤더 `x-internal-api-key`가 필요합니다.

## 테스트
```bash
npm test
```

소켓 리슨이 가능한 환경에서 통합 테스트까지 실행하려면:
```bash
CI_ALLOW_LISTEN=1 npm test
```

## 다음 계획 (Phase 2)
1. KIS 실제 TR 스펙 기반으로 REST/WS 요청/응답 매핑 정밀화
2. 장 운영 로직 강화 (한국장 캘린더/장중 상태/장종료 처리)
3. 주문 실행 안정화 (재시도 정책 정교화, idempotency 키 정책 확정)
4. 체결/주문 정합성 강화 (지연/중복 이벤트 처리 시나리오 확장)
5. 모의투자 5영업일 무중단 검증 자동화 및 리포트 산출
6. 실거래 전환용 사전점검 체크리스트/API 제공
