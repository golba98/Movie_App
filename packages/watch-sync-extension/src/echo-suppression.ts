export type MediaEventName = 'play' | 'playing' | 'pause' | 'seeking' | 'seeked' | 'ratechange'

interface RemoteOperation {
  revision: number
  expected: MediaEventName[]
  expectedPaused: boolean
  expectedPositionSeconds: number
  expectedRate: number
  positionToleranceSeconds: number
  rateTolerance: number
  deadlineMs: number
}

export class EchoSuppressor {
  private operation: RemoteOperation | null = null

  begin(operation: RemoteOperation) {
    if (!this.operation || operation.revision >= this.operation.revision) this.operation = { ...operation, expected: [...operation.expected] }
  }

  consume(
    event: MediaEventName,
    media: { paused: boolean; currentTime: number; playbackRate: number },
    nowMs: number,
  ) {
    const operation = this.operation
    if (!operation || nowMs > operation.deadlineMs) {
      this.operation = null
      return false
    }
    const expectedIndex = operation.expected.indexOf(event)
    if (expectedIndex < 0) return false
    const pausedMatches = event === 'pause' ? media.paused : event === 'play' || event === 'playing' ? !media.paused : true
    const positionMatches = event === 'seeking' || event === 'seeked' || event === 'play' || event === 'playing'
      ? Math.abs(media.currentTime - operation.expectedPositionSeconds) <= operation.positionToleranceSeconds
      : true
    const rateMatches = event === 'ratechange'
      ? Math.abs(media.playbackRate - operation.expectedRate) <= operation.rateTolerance
      : true
    const stateMatches = pausedMatches && positionMatches && rateMatches
    if (!stateMatches) return false
    operation.expected.splice(expectedIndex, 1)
    if (!operation.expected.length) this.operation = null
    return true
  }

  clearBefore(revision: number) {
    if (this.operation && this.operation.revision < revision) this.operation = null
  }
}
