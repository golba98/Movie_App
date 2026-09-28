import { KeyRound, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatDateTime } from '../../lib/format'
import type { ViewerAccount } from '../../types/account'
import type { AccountChanges } from './api'
import { dateInputValue, expiryValue, MIN_EXPIRY_DATE } from './expiry'
import { StatusPill } from './ui/StatusPill'

interface AccountCardProps {
  account: ViewerAccount
  busy: boolean
  onSave: (account: ViewerAccount, changes: AccountChanges) => void
  onReset: (account: ViewerAccount) => void
  onRevoke: (account: ViewerAccount) => void
  onDelete: (account: ViewerAccount) => void
}

export function AccountCard({ account, busy, onSave, onReset, onRevoke, onDelete }: AccountCardProps) {
  const [displayName, setDisplayName] = useState(account.displayName)
  const [active, setActive] = useState(account.active)
  const [expiresAt, setExpiresAt] = useState(dateInputValue(account.expiresAt))

  useEffect(() => {
    setDisplayName(account.displayName)
    setActive(account.active)
    setExpiresAt(dateInputValue(account.expiresAt))
  }, [account])

  return (
    <article className="glass-panel rounded-3xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-lg font-semibold">{account.username}</h3>
            <StatusPill active={account.active} activeLabel="Active" inactiveLabel="Disabled" inactiveClassName="bg-red-400/12 text-red-300" />
          </div>
          <p className="mt-1 text-xs text-zinc-500">Created {formatDateTime(account.createdAt)}</p>
        </div>
        {account.mustChangePassword && (
          <span className="rounded-full bg-amber-300/10 px-2.5 py-1 text-[11px] font-bold text-amber-200">Password change due</span>
        )}
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm text-zinc-300">Display name
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} className="form-input mt-2" />
        </label>
        <label className="text-sm text-zinc-300">Account expiry
          <input type="date" min={MIN_EXPIRY_DATE} value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="form-input mt-2" />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-4">
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
          <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} className="size-5 accent-white" />
          Account enabled
        </label>
        <p className="text-xs text-zinc-500">Last sign-in: {formatDateTime(account.lastLoginAt)}</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <button
          type="button"
          disabled={busy}
          onClick={() => onSave(account, { displayName, active, expiresAt: expiryValue(expiresAt) })}
          className="secondary-button justify-center sm:px-4"
        >
          Save
        </button>
        <button type="button" disabled={busy} onClick={() => onReset(account)} className="secondary-button justify-center sm:px-4">
          <KeyRound size={16} aria-hidden="true" />Reset password
        </button>
        <button type="button" disabled={busy} onClick={() => onRevoke(account)} className="secondary-button col-span-2 justify-center text-amber-200 sm:px-4">
          <RefreshCw size={16} aria-hidden="true" />Revoke sessions
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onDelete(account)}
          aria-label={`Delete account ${account.username}`}
          className="danger-button col-span-2 justify-center sm:ml-auto sm:px-4"
        >
          <Trash2 size={16} aria-hidden="true" />Delete account
        </button>
      </div>
    </article>
  )
}
