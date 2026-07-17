import { ArrowLeft, CircleStop, MonitorUp, Play, ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useVideoDiagnostics } from '../hooks/useVideoDiagnostics'

const TEST_MEDIA_URL = '/test-media/capture-test.mp4'

type CaptureState = 'idle' | 'starting' | 'active' | 'stopped'

export function CaptureCompatibilityPage() {
  const originalRef = useRef<HTMLVideoElement>(null)
  const previewRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [captureState, setCaptureState] = useState<CaptureState>('idle')
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [captureDetails, setCaptureDetails] = useState<string | null>(null)

  useVideoDiagnostics(originalRef, 'capture-test:original', TEST_MEDIA_URL)
  useVideoDiagnostics(previewRef, 'capture-test:preview', '(display stream)', false)

  const stopCapture = useCallback((state: CaptureState = 'stopped') => {
    const stream = streamRef.current
    stream?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (previewRef.current) previewRef.current.srcObject = null
    setCaptureState(state)
    setCaptureDetails(null)
  }, [])

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
  }, [])

  const startCapture = async () => {
    setCaptureError(null)
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setCaptureError('This browser does not expose the Screen Capture API in the current context.')
      return
    }

    stopCapture('starting')
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 60 } },
        audio: true,
      })
      streamRef.current = stream
      if (previewRef.current) {
        previewRef.current.srcObject = stream
        await previewRef.current.play().catch(() => undefined)
      }
      const videoTrack = stream.getVideoTracks()[0]
      const settings = videoTrack?.getSettings()
      setCaptureDetails([
        settings?.displaySurface ? `Surface: ${settings.displaySurface}` : 'Surface: browser/compositor selected',
        settings?.width && settings?.height ? `${settings.width}×${settings.height}` : null,
        settings?.frameRate ? `${Math.round(settings.frameRate)} fps` : null,
      ].filter(Boolean).join(' · '))
      setCaptureState('active')
      videoTrack?.addEventListener('ended', () => {
        streamRef.current = null
        if (previewRef.current) previewRef.current.srcObject = null
        setCaptureState('stopped')
        setCaptureDetails(null)
      }, { once: true })
    } catch (error) {
      stopCapture('idle')
      if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')) {
        setCaptureError('Screen capture was cancelled or not permitted. The original video was not changed.')
      } else {
        setCaptureError(error instanceof Error ? error.message : 'Screen capture could not start.')
      }
    }
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <Link to="/" className="inline-flex min-h-11 items-center gap-2 rounded-xl text-sm font-semibold text-zinc-400 hover:text-white">
        <ArrowLeft size={17} aria-hidden="true" />Back to Fedora Movies
      </Link>

      <header className="mt-5 max-w-4xl">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-400">Capture diagnostics</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">Screen-capture compatibility test</h1>
        <p className="mt-4 max-w-3xl leading-7 text-zinc-400">
          This page uses an original, unencrypted MP4 and normal HTML5 video. Start it playing, then capture this tab, window, or display and compare the preview. The test never pauses or hides the original video.
        </p>
      </header>

      <section className="mt-8 grid gap-6 lg:grid-cols-2" aria-label="Original and captured video comparison">
        <article className="rounded-3xl border border-white/8 bg-white/[0.025] p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div><p className="text-xs font-bold uppercase tracking-wider text-emerald-300">Original</p><h2 className="mt-1 text-lg font-semibold">Local authorised MP4</h2></div>
            <Play className="text-zinc-500" aria-hidden="true" />
          </div>
          <video
            ref={originalRef}
            src={TEST_MEDIA_URL}
            controls
            playsInline
            preload="metadata"
            loop
            className="block aspect-video w-full rounded-2xl bg-black object-contain"
            aria-label="Original capture compatibility test video"
          />
          <p className="mt-3 text-xs leading-5 text-zinc-500">The moving pattern flashes and beeps once per second so video visibility and audio synchronization can be checked in the resulting recording.</p>
        </article>

        <article className="rounded-3xl border border-white/8 bg-white/[0.025] p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div><p className="text-xs font-bold uppercase tracking-wider text-sky-300">Captured preview</p><h2 className="mt-1 text-lg font-semibold">Selected display stream</h2></div>
            <MonitorUp className="text-zinc-500" aria-hidden="true" />
          </div>
          <video
            ref={previewRef}
            controls
            autoPlay
            muted
            playsInline
            className="block aspect-video w-full rounded-2xl bg-black object-contain"
            aria-label="Captured display stream preview"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void startCapture()}
              disabled={captureState === 'starting' || captureState === 'active'}
              className="primary-button justify-center"
            >
              <MonitorUp size={17} aria-hidden="true" />
              {captureState === 'starting' ? 'Opening chooser…' : 'Test screen capture'}
            </button>
            <button
              type="button"
              onClick={() => stopCapture()}
              disabled={captureState !== 'active'}
              className="secondary-button justify-center"
            >
              <CircleStop size={17} aria-hidden="true" />Stop capture
            </button>
          </div>
          <p role="status" className="mt-3 min-h-5 text-xs text-zinc-500">
            {captureState === 'active' ? captureDetails : captureState === 'stopped' ? 'Capture stopped. The original video remains mounted.' : 'No display stream is active.'}
          </p>
          {captureError && <p role="alert" className="mt-2 rounded-xl border border-amber-300/20 bg-amber-300/8 px-3 py-2 text-xs text-amber-100">{captureError}</p>}
        </article>
      </section>

      <section className="mt-8 rounded-3xl border border-white/8 bg-white/[0.025] p-5 sm:p-7" aria-labelledby="interpret-heading">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-1 shrink-0 text-amber-200" aria-hidden="true" />
          <div>
            <h2 id="interpret-heading" className="text-xl font-semibold">Interpret the result</h2>
            <ul className="mt-4 grid gap-3 text-sm leading-6 text-zinc-400 md:grid-cols-2">
              <li><strong className="text-zinc-200">Both visible:</strong> clear HTML5 video capture works in this browser and session.</li>
              <li><strong className="text-zinc-200">Original visible, preview black:</strong> investigate browser GPU, Wayland, PipeWire, or compositor capture.</li>
              <li><strong className="text-zinc-200">This test works, another source is black:</strong> that source or its DRM/output policy is responsible.</li>
              <li><strong className="text-zinc-200">Original fails too:</strong> inspect source delivery, codec, content type, and byte-range support.</li>
            </ul>
          </div>
        </div>
      </section>
    </main>
  )
}
