import { ArrowLeft, LogOut, Search, Users } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Logo } from '../../components/layout/Logo'
import { ApiClientError } from '../../lib/api-client'
import { apiErrorMessage } from '../../lib/errors'
import type { AuditEvent, ViewerAccount } from '../../types/account'
import { AuthError, AuthField, AuthFieldGroup, AuthLayout, AuthSubmitButton } from '../auth/AuthLayout'
import { AccountCard } from './AccountCard'
import * as adminApi from './api'
import type { AccountChanges, NewAccountInput } from './api'
import { AuditLog } from './AuditLog'
import { CreateAccountForm } from './CreateAccountForm'
import { DeleteAccountDialog } from './DeleteAccountDialog'
import { MediaSourceCatalog } from './MediaSourceCatalog'
import { ResetPasswordDialog } from './ResetPasswordDialog'
import { SearchProviderCatalog } from './SearchProviderCatalog'
import { useAdminAction } from './useAdminAction'

const FALLBACK_ERROR = 'The request could not be completed.'
const NOTICE_DURATION_MS = 5_000

function AdminSignIn({ busy, error, onSignIn }: { busy: boolean; error: string | null; onSignIn: (password: string) => void }) {
  const [password, setPassword] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSignIn(password)
  }

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
      <form onSubmit={submit} className="mt-8 space-y-4">
        <AuthFieldGroup>
          <AuthField
            id="admin-password"
            label="Administrator password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
          />
        </AuthFieldGroup>

        {error && <AuthError message={error} />}

        <AuthSubmitButton submitting={busy} pendingLabel="Signing in…">Open admin</AuthSubmitButton>
      </form>
    </AuthLayout>
  )
}

export function AdminPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [accounts, setAccounts] = useState<ViewerAccount[]>([])
  const [audit, setAudit] = useState<AuditEvent[]>([])
  const [search, setSearch] = useState('')
  const [loadingData, setLoadingData] = useState(false)
  const [resetTarget, setResetTarget] = useState<ViewerAccount | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ViewerAccount | null>(null)
  const { busyId, error, notice, setError, setNotice, run } = useAdminAction(FALLBACK_ERROR)

  const loadData = useCallback(async (query = '') => {
    setLoadingData(true)
    setError(null)
    try {
      const [accountData, auditData] = await Promise.all([adminApi.getAccounts(query), adminApi.getAuditLog()])
      setAccounts(accountData.accounts)
      setAudit(auditData.events)
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.status === 401) setAuthenticated(false)
      else setError(apiErrorMessage(caught, FALLBACK_ERROR))
    } finally {
      setLoadingData(false)
    }
  }, [setError])

  useEffect(() => {
    adminApi.getAdminSession()
      .then(() => {
        setAuthenticated(true)
        void loadData()
      })
      .catch(() => setAuthenticated(false))
  }, [loadData])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(null), NOTICE_DURATION_MS)
    return () => window.clearTimeout(timeout)
  }, [notice, setNotice])

  const signIn = (password: string) => run('login', async () => {
    await adminApi.adminLogin(password)
    setAuthenticated(true)
    await loadData()
  })

  const signOut = async () => {
    try {
      await adminApi.adminLogout()
    } finally {
      setAuthenticated(false)
      setAccounts([])
      setAudit([])
    }
  }

  const createAccount = async (input: NewAccountInput) => {
    let created = false
    await run('create', async () => {
      const response = await adminApi.createAccount(input)
      created = true
      setNotice(`Created ${response.account.username}. Share the temporary password securely; it is not stored in this form.`)
      await loadData(search)
    })
    return created
  }

  const saveAccount = (account: ViewerAccount, changes: AccountChanges) => run(account.id, async () => {
    await adminApi.updateAccount(account.id, changes)
    setNotice(`Saved ${account.username}.`)
    await loadData(search)
  })

  const revokeSessions = (account: ViewerAccount) => run(account.id, async () => {
    await adminApi.revokeSessions(account.id)
    setNotice(`Revoked all sessions for ${account.username}.`)
    await loadData(search)
  })

  const resetPassword = (account: ViewerAccount, password: string) => run(account.id, async () => {
    await adminApi.resetPassword(account.id, password)
    setNotice(`Reset ${account.username}'s password and revoked their sessions.`)
    setResetTarget(null)
    await loadData(search)
  })

  const deleteAccount = (account: ViewerAccount) => run(account.id, async () => {
    await adminApi.deleteAccount(account.id)
    setNotice(`Deleted ${account.username}. Their sessions, favourites and watch parties were removed.`)
    setDeleteTarget(null)
    await loadData(search)
  })

  if (authenticated === null) {
    return (
      <main className="grid min-h-dvh place-items-center bg-canvas">
        <p role="status" className="text-zinc-400">Checking administrator session…</p>
      </main>
    )
  }

  if (!authenticated) return <AdminSignIn busy={busyId === 'login'} error={error} onSignIn={signIn} />

  return (
    <div className="min-h-dvh bg-canvas pb-safe">
      <header className="sticky top-0 z-30 border-b border-white/8 bg-black/90">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 py-2 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <Logo />
            <span className="hidden rounded-full bg-white/8 px-3 py-1 text-xs text-zinc-300 sm:inline">Admin console</span>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/" className="secondary-button px-3">
              <ArrowLeft size={17} aria-hidden="true" /><span className="hidden sm:inline">Viewer app</span>
            </Link>
            <button type="button" onClick={() => void signOut()} className="secondary-button px-3">
              <LogOut size={17} aria-hidden="true" /><span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">Account maintenance</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">Control the library</h1>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-white/6 px-4 py-2 text-sm text-zinc-300">
            <Users size={17} aria-hidden="true" />{accounts.length} shown
          </div>
        </div>

        <MediaSourceCatalog />
        <SearchProviderCatalog />
        <CreateAccountForm creating={busyId === 'create'} onCreate={createAccount} />

        <section aria-labelledby="accounts-heading" className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 id="accounts-heading" className="text-2xl font-semibold">Viewer accounts</h2>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void loadData(search)
              }}
              className="relative w-full sm:w-80"
            >
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} aria-hidden="true" />
              <input
                type="search"
                aria-label="Search viewer accounts"
                placeholder="Search accounts"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="form-input form-input-with-leading-icon"
              />
            </form>
          </div>
          {loadingData && !accounts.length ? (
            <p role="status" className="mt-6 text-zinc-400">Loading accounts…</p>
          ) : accounts.length ? (
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {accounts.map((account) => (
                <AccountCard
                  key={account.id}
                  account={account}
                  busy={busyId === account.id}
                  onSave={saveAccount}
                  onReset={setResetTarget}
                  onRevoke={revokeSessions}
                  onDelete={setDeleteTarget}
                />
              ))}
            </div>
          ) : (
            <p className="glass-panel mt-5 rounded-3xl p-8 text-center text-zinc-400">No accounts match this search.</p>
          )}
        </section>

        <AuditLog events={audit} />
      </main>

      {/* Fixed so showing or clearing a message never shifts the page layout. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 pb-safe" aria-live="polite">
        {error ? (
          <p role="alert" className="pointer-events-auto max-w-xl rounded-2xl border border-red-400/20 bg-[#1a0d0e]/95 px-4 py-3 text-sm text-red-200 shadow-2xl backdrop-blur-xl">{error}</p>
        ) : notice && (
          <p className="pointer-events-auto max-w-xl rounded-2xl border border-emerald-400/20 bg-[#0c1a14]/95 px-4 py-3 text-sm text-emerald-200 shadow-2xl backdrop-blur-xl">{notice}</p>
        )}
      </div>

      {resetTarget && (
        <ResetPasswordDialog
          account={resetTarget}
          busy={busyId === resetTarget.id}
          onClose={() => setResetTarget(null)}
          onReset={(password) => void resetPassword(resetTarget, password)}
        />
      )}

      {deleteTarget && (
        <DeleteAccountDialog
          account={deleteTarget}
          busy={busyId === deleteTarget.id}
          onClose={() => setDeleteTarget(null)}
          onDelete={() => void deleteAccount(deleteTarget)}
        />
      )}
    </div>
  )
}
