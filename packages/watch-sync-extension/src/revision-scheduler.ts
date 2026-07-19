export class RevisionScheduler {
  private revision = -1
  private timer: ReturnType<typeof setTimeout> | null = null

  schedule(revision: number, delayMs: number, callback: () => void) {
    if (revision < this.revision) return false
    this.revision = revision
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      if (revision === this.revision) callback()
    }, Math.max(0, delayMs))
    return true
  }

  cancel() {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }
}
