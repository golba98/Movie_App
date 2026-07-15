import { AlertTriangle, RotateCcw } from 'lucide-react'

export function ErrorMessage({
  message,
  onRetry,
  compact = false,
}: {
  message: string
  onRetry?: () => void
  compact?: boolean
}) {
  return (
    <div
      role="alert"
      className={`rounded-2xl border border-red-400/20 bg-red-500/8 ${compact ? 'p-4' : 'p-6'}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <AlertTriangle className="mt-0.5 shrink-0 text-red-300" size={20} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-red-100">{message}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-bold text-white transition hover:bg-white/15"
            >
              <RotateCcw size={16} aria-hidden="true" />
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
