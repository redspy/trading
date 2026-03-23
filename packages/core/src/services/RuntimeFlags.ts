export class RuntimeFlags {
  private killSwitch: boolean;

  public constructor(initialKillSwitch: boolean) {
    this.killSwitch = initialKillSwitch;
  }

  public isKillSwitchEnabled(): boolean {
    return this.killSwitch;
  }

  public enableKillSwitch(): void {
    this.killSwitch = true;
  }

  public disableKillSwitch(): void {
    this.killSwitch = false;
  }
}
