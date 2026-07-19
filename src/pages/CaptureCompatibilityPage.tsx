import { AlertTriangle, ArrowLeft, CheckCircle, CircleStop, Info, MonitorUp, Play, RefreshCw, ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useVideoDiagnostics } from '../hooks/useVideoDiagnostics'
import { PLAYBACK_CHAIN_DOMAINS } from '../utils/playbackDomains'

const TEST_MEDIA_URL = '/test-media/capture-test.mp4'

type CaptureState = 'idle' | 'starting' | 'active' | 'stopped'

interface DiagnosticsResult {
  title: string
  status: 'success' | 'warning' | 'error' | 'loading'
  message: string
  recommendation?: string
}

export function CaptureCompatibilityPage() {
  const originalRef = useRef<HTMLVideoElement>(null)
  const previewRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [captureState, setCaptureState] = useState<CaptureState>('idle')
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [captureDetails, setCaptureDetails] = useState<string | null>(null)

  const [checking, setChecking] = useState(false)
  const [checkResults, setCheckResults] = useState<DiagnosticsResult[]>([])

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

  const runNetworkChecks = useCallback(async () => {
    setChecking(true)
    const newResults: DiagnosticsResult[] = []

    // 1. Check Protocol
    const isHttps = window.location.protocol === 'https:'
    newResults.push({
      title: 'Security Protocol (SSL/TLS)',
      status: isHttps ? 'success' : 'warning',
      message: `The app is running over ${window.location.protocol.toUpperCase() || 'HTTP'}.`,
      recommendation: isHttps 
        ? undefined 
        : 'Modern browsers block Referer headers when loading HTTPS iframes from insecure HTTP pages. Access your app via HTTPS for best compatibility.',
    })

    // 2. Check Hostname / Origin (Domain vs Raw IP)
    const hostname = window.location.hostname
    const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/
    const isIpAddress = ipRegex.test(hostname)
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1'

    if (isIpAddress) {
      newResults.push({
        title: 'Referrer Origin (Local IP)',
        status: 'error',
        message: `Running on local IP address: ${hostname}`,
        recommendation: 'Streaming resolvers (like VidSrc) reject referrers from raw IP addresses (e.g. 192.168.x.x) as unauthorized hotlinking. Access the app using an HTTPS tunnel (e.g., ngrok) or configure local hostnames/DNS.',
      })
    } else if (isLocalhost) {
      newResults.push({
        title: 'Referrer Origin (Localhost)',
        status: 'success',
        message: 'Running on localhost.',
        recommendation: 'Localhost is typically whitelisted by resolvers, but this context is only accessible on the host machine. Mobile devices cannot access it without USB port forwarding (adb reverse).',
      })
    } else {
      newResults.push({
        title: 'Referrer Origin (Domain)',
        status: 'success',
        message: `Running on domain name: ${hostname}`,
      })
    }

    // 3. User Agent / ITP Detection
    const ua = navigator.userAgent
    const isIOS = /iPad|iPhone|iPod/.test(ua)
    const isSafari = /Safari/.test(ua) && !/Chrome/.test(ua)
    
    if (isIOS || isSafari) {
      newResults.push({
        title: 'iOS Safari WebKit / ITP Protection',
        status: 'warning',
        message: 'iOS/Safari browser environment detected.',
        recommendation: 'Apple\'s Intelligent Tracking Prevention (ITP) aggressively strips Referer headers in cross-origin iframes. Ensure you are accessing the app over HTTPS, or check that "Prevent Cross-Site Tracking" is temporarily disabled in Safari settings during local development.',
      })
    } else {
      newResults.push({
        title: 'Browser Environment',
        status: 'success',
        message: 'Standard desktop or Android browser detected.',
      })
    }

    // 4. Reachability/Connection Tests for the playback chain
    const testPromises = PLAYBACK_CHAIN_DOMAINS.map(async (domain) => {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 6000)
        await fetch(domain, { mode: 'no-cors', signal: controller.signal })
        clearTimeout(timeout)
        return {
          title: `Connection to ${domain.replace('https://', '')}`,
          status: 'success' as const,
          message: 'Server is reachable from this network.',
        }
      } catch {
        return {
          title: `Connection to ${domain.replace('https://', '')}`,
          status: 'error' as const,
          message: 'Connection timed out or failed.',
          recommendation: 'The streaming provider domain may be down, or blocked by your ISP, local router, or ad-blocker DNS (e.g. Pi-hole/AdGuard). Try testing on a different network or switching on/off a VPN.',
        }
      }
    })

    const testResults = await Promise.all(testPromises)
    newResults.push(...testResults)

    setCheckResults(newResults)
    setChecking(false)
  }, [])

  useEffect(() => {
    void runNetworkChecks()
  }, [runNetworkChecks])

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
      if (previewRef.current) {
        try {
          previewRef.current.srcObject = stream
          void previewRef.current.play().catch(() => {
            setCaptureError('The display stream started, but this browser could not autoplay the local preview. Use the preview controls to start it manually.')
          })
        } catch {
          setCaptureError('The display stream started, but this browser could not attach the local preview. The selected stream remains active.')
        }
      }
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
        <p className="text-xs font-black uppercase tracking-[0.18em] text-zinc-500">Diagnostics</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">System Diagnostics</h1>
        <p className="mt-4 max-w-3xl leading-7 text-zinc-400">
          Diagnose player network, referrer policy, tracking protections, and screen capture compatibility.
        </p>
      </header>

      {/* Network & Referrer Diagnostics Section */}
      <section className="mt-10 rounded-3xl border border-white/8 bg-white/[0.015] p-5 sm:p-7" aria-labelledby="network-diagnostics-heading">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-zinc-500">Policy & Connectivity Checks</p>
            <h2 id="network-diagnostics-heading" className="mt-1 text-2xl font-black text-white">Player Network & Referrer Diagnostics</h2>
          </div>
          <button
            type="button"
            onClick={() => void runNetworkChecks()}
            disabled={checking}
            className="secondary-button cursor-pointer text-xs"
          >
            <RefreshCw size={14} className={checking ? 'animate-spin' : ''} />
            Re-run checks
          </button>
        </div>

        {checking ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-zinc-400">
            <RefreshCw className="size-8 animate-spin text-brand-400" />
            <p className="mt-4 text-sm font-semibold">Running diagnostics checks…</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {checkResults.map((result, idx) => (
              <div
                key={idx}
                className="flex gap-3.5 rounded-2xl border border-white/5 bg-white/[0.012] p-4 text-zinc-300 transition hover:border-white/10"
              >
                <span className="mt-0.5 shrink-0">
                  {result.status === 'success' ? (
                    <CheckCircle className="size-5 text-emerald-400" />
                  ) : result.status === 'warning' ? (
                    <Info className="size-5 text-amber-400" />
                  ) : (
                    <AlertTriangle className="size-5 text-red-400" />
                  )}
                </span>
                <div className="flex-1">
                  <h4 className="text-sm font-black text-zinc-100">{result.title}</h4>
                  <p className="mt-1 text-xs font-semibold text-zinc-400">{result.message}</p>
                  {result.recommendation && (
                    <div className="mt-3.5 rounded-xl border border-white/5 bg-zinc-950/60 p-3 text-[11px] font-medium leading-relaxed text-zinc-400">
                      <strong className="text-zinc-200">Recommended fix:</strong> {result.recommendation}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Screen Capture Compatibility Section */}
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

