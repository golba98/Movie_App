import { AlertTriangle, CheckCircle, Info, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

interface DiagnosticsResult {
  title: string
  status: 'success' | 'warning' | 'error' | 'loading'
  message: string
  recommendation?: string
}

interface PlayerDiagnosticsModalProps {
  isOpen: boolean
  onClose: () => void
  resolvedUrl: string | null
}

export function PlayerDiagnosticsModal({ isOpen, onClose, resolvedUrl }: PlayerDiagnosticsModalProps) {
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<DiagnosticsResult[]>([])

  const runDiagnostics = useCallback(async () => {
    setLoading(true)
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

    // 4. Resolved URL Display
    newResults.push({
      title: 'Resolved Embed URL',
      status: resolvedUrl ? 'success' : 'warning',
      message: resolvedUrl ? `Resolved to: ${resolvedUrl}` : 'No player URL is currently resolved.',
      recommendation: resolvedUrl ? undefined : 'Start playback on a movie or episode to resolve the streaming source.',
    })

    // 5. Reachability/Connection Tests for Common Domains
    const domainsToTest = ['https://vidsrc.to', 'https://vidsrc.xyz', 'https://vidsrc.me']
    const testPromises = domainsToTest.map(async (domain) => {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 6000)
        
        // Use no-cors to permit cross-origin connectivity checks
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

    setResults(newResults)
    setLoading(false)
  }, [resolvedUrl])

  useEffect(() => {
    if (isOpen) {
      void runDiagnostics()
    }
  }, [isOpen, runDiagnostics])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm sm:p-6 md:p-10">
      <div className="relative w-full max-w-2xl rounded-3xl border border-white/8 bg-zinc-950 p-6 shadow-2xl sm:p-8">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 grid size-10 place-items-center rounded-full border border-white/10 bg-zinc-900 text-zinc-400 hover:text-white transition"
          aria-label="Close diagnostics"
        >
          <X size={18} />
        </button>

        <header className="mb-6">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-zinc-500">Troubleshooter</p>
          <h2 className="mt-2 text-2xl font-black text-white sm:text-3xl">Player Diagnostics</h2>
          <p className="mt-1 text-sm text-zinc-400">
            Diagnose compatibility issues with local development and third-party resolvers.
          </p>
        </header>

        <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1 scrollbar-subtle">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-zinc-400">
              <RefreshCw className="size-8 animate-spin text-brand-400" />
              <p className="mt-4 text-sm font-semibold">Running network and policy checks…</p>
            </div>
          ) : (
            results.map((result, idx) => (
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
            ))
          )}
        </div>

        <footer className="mt-6 flex flex-wrap justify-end gap-3 border-t border-white/5 pt-5">
          <button
            type="button"
            onClick={() => void runDiagnostics()}
            disabled={loading}
            className="secondary-button cursor-pointer text-xs"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Re-run checks
          </button>
          <button
            type="button"
            onClick={onClose}
            className="primary-button cursor-pointer text-xs"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  )
}
