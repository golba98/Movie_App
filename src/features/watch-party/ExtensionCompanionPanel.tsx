import { MonitorSmartphone } from 'lucide-react'
import type { ExtensionBridgeStatus } from './extension-bridge'

interface ExtensionCompanionPanelProps {
  status: ExtensionBridgeStatus
  message: string
  companionMode: boolean
  onConnect: () => void
  onDisconnect: () => void
}

export function CompanionActiveNotice() {
  return (
    <div className="grid aspect-video place-items-center rounded-3xl border border-sky-300/20 bg-sky-300/[0.06] p-8 text-center">
      <div>
        <MonitorSmartphone className="mx-auto text-sky-200" size={42} aria-hidden="true" />
        <h2 className="mt-4 text-xl font-black">Companion playback is active</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-zinc-300">
          The in-app player is unmounted. Playback commands now target the native video selected in your browser tab.
        </p>
      </div>
    </div>
  )
}

export function ExtensionCompanionPanel({ status, message, companionMode, onConnect, onDisconnect }: ExtensionCompanionPanelProps) {
  return (
    <section className="mt-4 rounded-2xl border border-white/8 bg-white/[0.025] p-4" aria-label="Browser extension companion">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold"><MonitorSmartphone size={17} aria-hidden="true" />Browser extension companion</h2>
          <p className="mt-1 text-xs leading-5 text-zinc-400" role="status">{message}</p>
          <p className="mt-1 text-[11px] uppercase tracking-wide text-zinc-600">Status: {status}</p>
        </div>
        {companionMode ? (
          <button type="button" onClick={onDisconnect} className="secondary-button min-h-10">Use in-app player</button>
        ) : (
          <button type="button" onClick={onConnect} className="secondary-button min-h-10"><MonitorSmartphone size={15} />Connect browser extension</button>
        )}
      </div>
    </section>
  )
}
