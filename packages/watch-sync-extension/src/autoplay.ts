export class AutoplayGate {
  private blocked = false

  get canAttempt() {
    return !this.blocked
  }

  reject() {
    this.blocked = true
  }

  activate(trusted: boolean) {
    if (trusted) this.blocked = false
  }
}
