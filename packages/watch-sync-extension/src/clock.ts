interface ClockSample {
  rttMs: number
  offsetMs: number
}

export class ClockEstimator {
  private samples: ClockSample[] = []

  addSample(localSendEpochMs: number, localReceiveEpochMs: number, serverNowMs: number) {
    const rttMs = Math.max(0, localReceiveEpochMs - localSendEpochMs)
    const offsetMs = serverNowMs - (localSendEpochMs + localReceiveEpochMs) / 2
    this.samples.push({ rttMs, offsetMs })
    this.samples = this.samples.slice(-8)
    return { rttMs, offsetMs, estimateMs: this.estimate() }
  }

  estimate() {
    if (!this.samples.length) return 0
    const offsets = [...this.samples]
      .sort((left, right) => left.rttMs - right.rttMs)
      .slice(0, 3)
      .map((sample) => sample.offsetMs)
      .sort((left, right) => left - right)
    return offsets[Math.floor(offsets.length / 2)]
  }

  get count() {
    return this.samples.length
  }
}

export function localEpochMs() {
  return performance.timeOrigin + performance.now()
}
