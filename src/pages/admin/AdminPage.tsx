import {
  Activity,
  ArrowLeft,
  KeyRound,
  LogOut,
  RefreshCw,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ApiClientError, apiRequest } from '../../api/client'
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

interface AccountCardProps {
  account: ViewerAccount
  busy: boolean
  onSave: (account: ViewerAccount, changes: { displayName: string; active: boolean; expiresAt: number | null }) => Promise<void>
  onReset: (account: ViewerAccount) => void
  onRevoke: (account: ViewerAccount) => Promise<void>
}

function AccountCard({ account, busy, onSave, onReset, onRevoke }: AccountCardProps) {
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

  if (authenticated === null) {
    return <main className="grid min-h-dvh place-items-center bg-[#070709]"><p role="status" className="text-zinc-400">Checking administrator session…</p></main>
  }

  if (!authenticated) {
    return (
      <main className="auth-surface min-h-dvh px-4 py-8 sm:grid sm:place-items-center">
        <section className="glass-panel mx-auto w-full max-w-md rounded-[2rem] p-6 sm:p-9">
          <div className="flex justify-center"><Logo /></div>
          <div className="mx-auto mt-8 grid size-14 place-items-center rounded-2xl bg-white text-zinc-950"><ShieldCheck aria-hidden="true" /></div>
          <h1 className="mt-5 text-center text-3xl font-semibold tracking-tight">Administrator</h1>
          <p className="mt-2 text-center text-sm leading-6 text-zinc-400">Use the Cloudflare administrator password to maintain viewer accounts.</p>
          <form onSubmit={signIn} className="mt-7 space-y-5">
            <label className="block text-sm font-medium">Administrator password
              <input required type="password" autoComplete="current-password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} className="form-input mt-2" />
            </label>
            {error && <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
            <button type="submit" disabled={busyId === 'login'} className="primary-button w-full justify-center">{busyId === 'login' ? 'Signing in…' : 'Open admin'}</button>
          </form>
          <Link to="/" className="mt-5 flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm text-zinc-400 hover:text-white"><ArrowLeft size={16} aria-hidden="true" />Back to Fedora Movies</Link>
        </section>
      </main>
    )
  }

  return (
    <div className="min-h-dvh bg-[#070709] pb-safe">
      <header className="sticky top-0 z-30 border-b border-white/8 bg-black/75 backdrop-blur-2xl">
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

        {(error || notice) && <div className="mt-6" aria-live="polite">{error ? <p role="alert" className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p> : <p className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">{notice}</p>}</div>}

        <section aria-labelledby="create-account-heading" className="glass-panel mt-8 rounded-[2rem] p-5 sm:p-7">
          <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-white text-zinc-950"><UserPlus size={20} aria-hidden="true" /></span><div><h2 id="create-account-heading" className="text-xl font-semibold">Create viewer account</h2><p className="text-sm text-zinc-500">Every new viewer must replace their temporary password.</p></div></div>
          <form onSubmit={create} className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-sm text-zinc-300">Username<input required minLength={3} maxLength={32} pattern="[A-Za-z0-9._-]+" value={newAccount.username} onChange={(event) => setNewAccount((current) => ({ ...current, username: event.target.value }))} className="form-input mt-2" /></label>
            <label className="text-sm text-zinc-300">Display name<input required maxLength={80} value={newAccount.displayName} onChange={(event) => setNewAccount((current) => ({ ...current, displayName: event.target.value }))} className="form-input mt-2" /></label>
            <label className="text-sm text-zinc-300">Temporary password<input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={newAccount.temporaryPassword} onChange={(event) => setNewAccount((current) => ({ ...current, temporaryPassword: event.target.value }))} className="form-input mt-2" /></label>
            <label className="text-sm text-zinc-300">Expiry (optional)<input type="date" min={MIN_EXPIRY_DATE} value={newAccount.expiresAt} onChange={(event) => setNewAccount((current) => ({ ...current, expiresAt: event.target.value }))} className="form-input mt-2" /></label>
            <button type="submit" disabled={busyId === 'create'} className="primary-button justify-center md:col-span-2 xl:col-span-4">{busyId === 'create' ? 'Creating…' : 'Create account'}<UserPlus size={18} aria-hidden="true" /></button>
          </form>
        </section>

        <section aria-labelledby="accounts-heading" className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 id="accounts-heading" className="text-2xl font-semibold">Viewer accounts</h2>
            <form onSubmit={(event) => { event.preventDefault(); void loadData(search) }} className="relative w-full sm:w-80">
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} aria-hidden="true" />
              <input type="search" aria-label="Search viewer accounts" placeholder="Search accounts" value={search} onChange={(event) => setSearch(event.target.value)} className="form-input pl-11" />
            </form>
          </div>
          {loadingData ? <p role="status" className="mt-6 text-zinc-400">Loading accounts…</p> : accounts.length ? <div className="mt-5 grid gap-4 lg:grid-cols-2">{accounts.map((account) => <AccountCard key={account.id} account={account} busy={busyId === account.id} onSave={saveAccount} onReset={setResetAccount} onRevoke={revokeSessions} />)}</div> : <p className="glass-panel mt-5 rounded-3xl p-8 text-center text-zinc-400">No accounts match this search.</p>}
        </section>

        <section aria-labelledby="audit-heading" className="mt-12">
          <div className="flex items-center gap-3"><Activity className="text-zinc-500" aria-hidden="true" /><div><h2 id="audit-heading" className="text-2xl font-semibold">Recent admin activity</h2><p className="text-sm text-zinc-500">The latest 100 security-relevant actions.</p></div></div>
          <div className="mt-5 overflow-hidden rounded-3xl border border-white/8 bg-white/[0.025]">
            {audit.length ? <ul className="divide-y divide-white/8">{audit.map((event) => <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5"><div className="min-w-0"><p className="text-sm font-medium text-zinc-200">{event.action.replaceAll('.', ' · ')}</p><p className="truncate text-xs text-zinc-500">{event.targetUsername ?? 'Administrator session'}</p></div><time className="text-xs text-zinc-500" dateTime={new Date(event.createdAt).toISOString()}>{formatDate(event.createdAt)}</time></li>)}</ul> : <p className="p-6 text-sm text-zinc-500">No activity recorded yet.</p>}
          </div>
        </section>
      </main>

      {resetAccount && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/75 p-3 backdrop-blur-sm sm:place-items-center" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setResetAccount(null) }}>
          <section role="dialog" aria-modal="true" aria-labelledby="reset-heading" className="glass-panel w-full max-w-md rounded-[2rem] p-6 sm:p-8">
            <span className="grid size-12 place-items-center rounded-2xl bg-amber-300 text-zinc-950"><KeyRound aria-hidden="true" /></span>
            <h2 id="reset-heading" className="mt-5 text-2xl font-semibold">Reset {resetAccount.username}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">This revokes every active session. The viewer must change the new temporary password at their next sign-in.</p>
            <form onSubmit={reset} className="mt-6 space-y-4">
              <label className="block text-sm">New temporary password<input autoFocus required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} className="form-input mt-2" /></label>
              <div className="grid grid-cols-2 gap-3"><button type="button" onClick={() => { setResetAccount(null); setResetPassword('') }} className="secondary-button justify-center">Cancel</button><button type="submit" disabled={busyId === resetAccount.id} className="primary-button justify-center">Reset</button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}
