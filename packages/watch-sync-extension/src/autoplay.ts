/**
 * Remembers when the browser refused autoplay, so play() is not retried until
 * the viewer interacts with the page (a trusted click or key press).
 */
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
