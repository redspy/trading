// ─────────────────────────────────────────────────────────────
// 런타임 제어 플래그
// 서버 재시작 없이 동적으로 변경 가능한 운영 상태를 관리한다.
// 킬스위치는 POST /internal/killswitch/enable|disable API로 제어된다.
// ─────────────────────────────────────────────────────────────

export class RuntimeFlags {
  private killSwitch: boolean;

  public constructor(initialKillSwitch: boolean) {
    this.killSwitch = initialKillSwitch;
  }

  /** 킬스위치 활성화 여부 확인 */
  public isKillSwitchEnabled(): boolean {
    return this.killSwitch;
  }

  /** 킬스위치 활성화 — 이후 모든 신규 주문이 차단된다 */
  public enableKillSwitch(): void {
    this.killSwitch = true;
  }

  /** 킬스위치 해제 — 주문 처리를 재개한다 */
  public disableKillSwitch(): void {
    this.killSwitch = false;
  }
}
