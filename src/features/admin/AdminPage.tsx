import {
  Activity,
  ArrowLeft,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  RefreshCw,
  Search,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ApiClientError, apiRequest } from '../../lib/api-client'
import { AdminMediaSourceCatalog, AdminSearchProvidersCatalog } from './MediaSourceCatalog'
import { AuthError, AuthField, AuthFieldGroup, AuthLayout, AuthSubmitButton } from '../auth/AuthLayout'
import { Logo } from '../../components/layout/Logo'
import type { AuditEvent, ViewerAccount } from '../../types/account'

function messageFor(error: unknown) {
  return error instanceof ApiClientError ? error.message : 'The request could not be completed.'
}

function formatDate(value: number | null) {
  if (!value) return 'Never'
  return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }).format(value)
}

function dateInputValue(value: number | null) {
  if (!value) return ''
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const MIN_EXPIRY_DATE = dateInputValue(new Date().getTime() + 86_400_000)

function expiryValue(value: string) {
  return value ? new Date(`${value}T23:59:59`).getTime() : null
}

interface PasswordInputProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
}

function PasswordInput({ id, label, value, onChange, autoFocus }: PasswordInputProps) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="text-sm text-zinc-300">
      <label htmlFor={id}>{label}</label>
      <span className="relative mt-2 block">
        <input
          id={id}
          required
          type={visible ? 'text' : 'password'}
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
          autoFocus={autoFocus}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="form-input form-input-with-action"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          onMouseDown={(event) => event.preventDefault()}
          aria-label={`${visible ? 'Hide' : 'Show'} ${label}`}
          aria-controls={id}
          aria-pressed={visible}
          className="absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-zinc-500 transition hover:bg-white/8 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          {visible ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
        </button>
      </span>
    </div>
  )
}

interface AccountCardProps {
  account: ViewerAccount
  busy: boolean
  onSave: (account: ViewerAccount, changes: { displayName: string; active: boolean; expiresAt: number | null }) => Promise<void>
  onReset: (account: ViewerAccount) => void
  onRevoke: (account: ViewerAccount) => Promise<void>
  onDelete: (account: ViewerAccount) => void
}

function AccountCard({ account, busy, onSave, onReset, onRevoke, onDelete }: AccountCardProps) {
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
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${account.active ? 'bg-emerald-400/12 text-emerald-300' : 'bg-red-400/12 text-red-300'}`}>
              {account.active ? 'Active' : 'Disabled'}
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">Created {formatDate(account.createdAt)}</p>
        </div>
        {account.mustChangePassword && <span className="rounded-full bg-amber-300/10 px-2.5 py-1 text-[11px] font-bold text-amber-200">Password change due</span>}
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
        <p className="text-xs text-zinc-500">Last sign-in: {formatDate(account.lastLoginAt)}</p>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <button type="button" disabled={busy} onClick={() => void onSave(account, { displayName, active, expiresAt: expiryValue(expiresAt) })} className="secondary-button justify-center sm:px-4">Save</button>
        <button type="button" disabled={busy} onClick={() => onReset(account)} className="secondary-button justify-center sm:px-4"><KeyRound size={16} aria-hidden="true" />Reset password</button>
        <button type="button" disabled={busy} onClick={() => void onRevoke(account)} className="secondary-button col-span-2 justify-center text-amber-200 sm:px-4"><RefreshCw size={16} aria-hidden="true" />Revoke sessions</button>
        <button type="button" disabled={busy} onClick={() => onDelete(account)} aria-label={`Delete account ${account.username}`} className="danger-button col-span-2 justify-center sm:ml-auto sm:px-4"><Trash2 size={16} aria-hidden="true" />Delete account</button>
      </div>
    </article>
  )
}

export function AdminPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [adminPassword, setAdminPassword] = useState('')
  const [accounts, setAccounts] = useState<ViewerAccount[]>([])
  const [audit, setAudit] = useState<AuditEvent[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [loadingData, setLoadingData] = useState(false)
  const [resetAccount, setResetAccount] = useState<ViewerAccount | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ViewerAccount | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [newAccount, setNewAccount] = useState({
    username: '',
    displayName: '',
    temporaryPassword: '',
    expiresAt: '',
  })

  const loadData = useCallback(async (query = '') => {
    setLoadingData(true)
    setError(null)
    try {
      const [accountData, auditData] = await Promise.all([
        apiRequest<{ accounts: ViewerAccount[] }>(`/api/admin/accounts?search=${encodeURIComponent(query)}`),
        apiRequest<{ events: AuditEvent[] }>('/api/admin/audit'),
      ])
      setAccounts(accountData.accounts)
      setAudit(auditData.events)
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.status === 401) setAuthenticated(false)
      else setError(messageFor(caught))
    } finally {
      setLoadingData(false)
    }
  }, [])

  useEffect(() => {
    apiRequest<{ authenticated: boolean }>('/api/admin/session')
      .then(() => {
        setAuthenticated(true)
        void loadData()
      })
      .catch(() => setAuthenticated(false))
  }, [loadData])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(null), 5000)
    return () => window.clearTimeout(timeout)
  }, [notice])

  const signIn = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setBusyId('login')
    try {
      await apiRequest('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password: adminPassword }),
      })
      setAdminPassword('')
      setAuthenticated(true)
      await loadData()
    } catch (caught) {
      setError(messageFor(caught))
    } finally {
      setBusyId(null)
    }
  }

  const signOut = async () => {
    try {
      await apiRequest('/api/admin/logout', { method: 'POST', body: '{}' })
    } finally {
      setAuthenticated(false)
      setAccounts([])
      setAudit([])
    }
  }

  const create = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setBusyId('create')
    try {
      const response = await apiRequest<{ account: ViewerAccount }>('/api/admin/accounts', {
        method: 'POST',
        body: JSON.stringify({
          username: newAccount.username,
          displayName: newAccount.displayName,
          temporaryPassword: newAccount.temporaryPassword,
          expiresAt: expiryValue(newAccount.expiresAt),
        }),
      })
      setNewAccount({ username: '', displayName: '', temporaryPassword: '', expiresAt: '' })
      setNotice(`Created ${response.account.username}. Share the temporary password securely; it is not stored in this form.`)
      await loadData(search)
    } catch (caught) {
      setError(messageFor(caught))
    } finally {
      setBusyId(null)
    }
  }

  const saveAccount = async (
    account: ViewerAccount,
    changes: { displayName: string; active: boolean; expiresAt: number | null },
  ) => {
    setBusyId(account.id)
    setError(null)
    try {
      await apiRequest(`/api/admin/accounts/${encodeURIComponent(account.id)}`, {
        method: 'PATCH',
        body: JSON.stringify(changes),
      })
      setNotice(`Saved ${account.username}.`)
      await loadData(search)
    } catch (caught) {
      setError(messageFor(caught))
    } finally {
      setBusyId(null)
    }
  }

  const revokeSessions = async (account: ViewerAccount) => {
    setBusyId(account.id)
    setError(null)
    try {
      await apiRequest(`/api/admin/accounts/${encodeURIComponent(account.id)}/revoke-sessions`, {
        method: 'POST',
        body: '{}',
      })
      setNotice(`Revoked all sessions for ${account.username}.`)
      await loadData(search)
    } catch (caught) {
      setError(messageFor(caught))
    } finally {
      setBusyId(null)
    }
  }

  const reset = async (event: FormEvent) => {
    event.preventDefault()
    if (!resetAccount) return
    setBusyId(resetAccount.id)
    setError(null)
    try {
      await apiRequest(`/api/admin/accounts/${encodeURIComponent(resetAccount.id)}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ temporaryPassword: resetPassword }),
      })
      setNotice(`Reset ${resetAccount.username}'s password and revoked their sessions.`)
      setResetPassword('')
      setResetAccount(null)
      await loadData(search)
    } catch (caught) {
      setError(messageFor(caught))
    } finally {
      setBusyId(null)
    }
  }

  const closeDelete = () => {
    setDeleteTarget(null)
    setDeleteConfirmation('')
  }

  const deleteAccount = async (event: FormEvent) => {
    event.preventDefault()
    if (!deleteTarget || deleteConfirmation !== deleteTarget.username) return
    const target = deleteTarget
    setBusyId(target.id)
    setError(null)
    try {
      await apiRequest(`/api/admin/accounts/${encodeURIComponent(target.id)}`, { method: 'DELETE' })
      setNotice(`Deleted ${target.username}. Their sessions, favourites and watch parties were removed.`)
      closeDelete()
      await loadData(search)
    } catch (caught) {
      setError(messageFor(caught))
    } finally {
      setBusyId(null)
    }
  }

  if (authenticated === null) {
    return <main className="grid min-h-dvh place-items-center bg-[#070709]"><p role="status" className="text-zinc-400">Checking administrator session…</p></main>
  }

  if (!authenticated) {
    return (
      <AuthLayout
        eyebrow="Admin console"
        title="Administrator"
        subtitle="Use the Cloudflare administrator password to maintain viewer accounts."
        footer={
          <Link to="/" className="inline-flex items-center gap-1.5 text-zinc-400 transition-colors hover:text-white">
            <ArrowLeft size={14} aria-hidden="true" />Back to Fedora Movies
          </Link>
        }
      >
        <form onSubmit={signIn} className="mt-8 space-y-4">
          <AuthFieldGroup>
            <AuthField
              id="admin-password"
              label="Administrator password"
              type="password"
              autoComplete="current-password"
              value={adminPassword}
              onChange={setAdminPassword}
            />
          </AuthFieldGroup>

          {error && <AuthError message={error} />}

          <AuthSubmitButton submitting={busyId === 'login'} pendingLabel="Signing in…">Open admin</AuthSubmitButton>
        </form>
      </AuthLayout>
    )
  }

  return (
    <div className="min-h-dvh bg-[#070709] pb-safe">
      <header className="sticky top-0 z-30 border-b border-white/8 bg-black/90">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 py-2 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4"><Logo /><span className="hidden rounded-full bg-white/8 px-3 py-1 text-xs text-zinc-300 sm:inline">Admin console</span></div>
          <div className="flex items-center gap-2">
            <Link to="/" className="secondary-button px-3"><ArrowLeft size={17} aria-hidden="true" /><span className="hidden sm:inline">Viewer app</span></Link>
            <button type="button" onClick={() => void signOut()} className="secondary-button px-3"><LogOut size={17} aria-hidden="true" /><span className="hidden sm:inline">Sign out</span></button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">Account maintenance</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">Control the library</h1></div>
          <div className="flex items-center gap-2 rounded-full bg-white/6 px-4 py-2 text-sm text-zinc-300"><Users size={17} aria-hidden="true" />{accounts.length} shown</div>
        </div>

        <AdminMediaSourceCatalog />

        <AdminSearchProvidersCatalog />

        <section aria-labelledby="create-account-heading" className="glass-panel mt-8 rounded-[2rem] p-5 sm:p-7">
          <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-white text-zinc-950"><UserPlus size={20} aria-hidden="true" /></span><div><h2 id="create-account-heading" className="text-xl font-semibold">Create viewer account</h2><p className="text-sm text-zinc-500">Every new viewer must replace their temporary password.</p></div></div>
          <form onSubmit={create} className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-sm text-zinc-300">Username<input required minLength={3} maxLength={32} pattern="[A-Za-z0-9._-]+" value={newAccount.username} onChange={(event) => setNewAccount((current) => ({ ...current, username: event.target.value }))} className="form-input mt-2" /></label>
            <label className="text-sm text-zinc-300">Display name<input required maxLength={80} value={newAccount.displayName} onChange={(event) => setNewAccount((current) => ({ ...current, displayName: event.target.value }))} className="form-input mt-2" /></label>
            <PasswordInput id="new-account-temporary-password" label="Temporary password" value={newAccount.temporaryPassword} onChange={(temporaryPassword) => setNewAccount((current) => ({ ...current, temporaryPassword }))} />
            <label className="text-sm text-zinc-300">Expiry (optional)<input type="date" min={MIN_EXPIRY_DATE} value={newAccount.expiresAt} onChange={(event) => setNewAccount((current) => ({ ...current, expiresAt: event.target.value }))} className="form-input mt-2" /></label>
            <button type="submit" disabled={busyId === 'create'} className="primary-button justify-center md:col-span-2 xl:col-span-4">{busyId === 'create' ? 'Creating…' : 'Create account'}<UserPlus size={18} aria-hidden="true" /></button>
          </form>
        </section>

        <section aria-labelledby="accounts-heading" className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 id="accounts-heading" className="text-2xl font-semibold">Viewer accounts</h2>
            <form onSubmit={(event) => { event.preventDefault(); void loadData(search) }} className="relative w-full sm:w-80">
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} aria-hidden="true" />
              <input type="search" aria-label="Search viewer accounts" placeholder="Search accounts" value={search} onChange={(event) => setSearch(event.target.value)} className="form-input form-input-with-leading-icon" />
            </form>
          </div>
          {loadingData && !accounts.length ? <p role="status" className="mt-6 text-zinc-400">Loading accounts…</p> : accounts.length ? <div className="mt-5 grid gap-4 lg:grid-cols-2">{accounts.map((account) => <AccountCard key={account.id} account={account} busy={busyId === account.id} onSave={saveAccount} onReset={setResetAccount} onRevoke={revokeSessions} onDelete={setDeleteTarget} />)}</div> : <p className="glass-panel mt-5 rounded-3xl p-8 text-center text-zinc-400">No accounts match this search.</p>}
        </section>

        <section aria-labelledby="audit-heading" className="mt-12">
          <div className="flex items-center gap-3"><Activity className="text-zinc-500" aria-hidden="true" /><div><h2 id="audit-heading" className="text-2xl font-semibold">Recent admin activity</h2><p className="text-sm text-zinc-500">The latest 100 security-relevant actions.</p></div></div>
          <div className="mt-5 overflow-hidden rounded-3xl border border-white/8 bg-white/[0.025]">
            {audit.length ? <ul className="divide-y divide-white/8">{audit.map((event) => <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5"><div className="min-w-0"><p className="text-sm font-medium text-zinc-200">{event.action.replaceAll('.', ' · ')}</p><p className="truncate text-xs text-zinc-500">{event.targetUsername ?? 'Administrator session'}</p></div><time className="text-xs text-zinc-500" dateTime={new Date(event.createdAt).toISOString()}>{formatDate(event.createdAt)}</time></li>)}</ul> : <p className="p-6 text-sm text-zinc-500">No activity recorded yet.</p>}
          </div>
        </section>
      </main>

      {/* Fixed so showing or clearing a message never shifts the page layout. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 pb-safe" aria-live="polite">
        {(error || notice) && (error ? <p role="alert" className="pointer-events-auto max-w-xl rounded-2xl border border-red-400/20 bg-[#1a0d0e]/95 px-4 py-3 text-sm text-red-200 shadow-2xl backdrop-blur-xl">{error}</p> : <p className="pointer-events-auto max-w-xl rounded-2xl border border-emerald-400/20 bg-[#0c1a14]/95 px-4 py-3 text-sm text-emerald-200 shadow-2xl backdrop-blur-xl">{notice}</p>)}
      </div>

      {resetAccount && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/75 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-sm sm:place-items-center" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setResetAccount(null) }}>
          <section role="dialog" aria-modal="true" aria-labelledby="reset-heading" className="glass-panel max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-[2rem] p-6 sm:p-8 short:p-5">
            <span className="grid size-12 place-items-center rounded-2xl bg-amber-300 text-zinc-950"><KeyRound aria-hidden="true" /></span>
            <h2 id="reset-heading" className="mt-5 text-2xl font-semibold">Reset {resetAccount.username}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">This revokes every active session. The viewer must change the new temporary password at their next sign-in.</p>
            <form onSubmit={reset} className="mt-6 space-y-4">
              <PasswordInput id="reset-account-temporary-password" label="New temporary password" autoFocus value={resetPassword} onChange={setResetPassword} />
              <div className="grid grid-cols-2 gap-3"><button type="button" onClick={() => { setResetAccount(null); setResetPassword('') }} className="secondary-button justify-center">Cancel</button><button type="submit" disabled={busyId === resetAccount.id} className="primary-button justify-center">Reset</button></div>
            </form>
          </section>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/75 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-sm sm:place-items-center" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDelete() }} onKeyDown={(event) => { if (event.key === 'Escape') closeDelete() }}>
          <section role="dialog" aria-modal="true" aria-labelledby="delete-heading" aria-describedby="delete-description" className="glass-panel max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-[2rem] p-6 sm:p-8 short:p-5">
            <span className="grid size-12 place-items-center rounded-2xl bg-red-500 text-white short:hidden"><Trash2 aria-hidden="true" /></span>
            <h2 id="delete-heading" className="mt-5 text-2xl font-semibold short:mt-0">Delete {deleteTarget.username}?</h2>
            <p id="delete-description" className="mt-2 text-sm leading-6 text-zinc-400">This permanently deletes the account, signs the viewer out everywhere, and removes their favourites and watch parties. This cannot be undone. To keep the data, disable the account instead.</p>
            <form onSubmit={deleteAccount} className="mt-6 space-y-4">
              <label htmlFor="delete-account-confirmation" className="block text-sm text-zinc-300">
                Type <strong className="font-semibold text-white">{deleteTarget.username}</strong> to confirm
                <input id="delete-account-confirmation" autoFocus autoComplete="off" autoCapitalize="none" spellCheck={false} value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} className="form-input mt-2" />
              </label>
              <div className="grid gap-3 min-[360px]:grid-cols-2"><button type="button" onClick={closeDelete} className="secondary-button justify-center">Cancel</button><button type="submit" disabled={busyId === deleteTarget.id || deleteConfirmation !== deleteTarget.username} className="danger-button justify-center whitespace-nowrap">{busyId === deleteTarget.id ? 'Deleting…' : 'Delete account'}</button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}
