import { ArrowRight, LockKeyhole } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { ApiClientError } from '../../api/client'
import { Logo } from '../../components/layout/Logo'
import { useAuth } from '../../hooks/useAuth'

function safeNext(value: string | null) {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/'
}

export function LoginPage() {
  const { account, loading, login } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const next = safeNext(searchParams.get('next'))

  if (!loading && account) {
    return <Navigate to={account.mustChangePassword ? `/change-password?next=${encodeURIComponent(next)}` : next} replace />
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const signedIn = await login(username, password)
      navigate(
        signedIn.mustChangePassword ? `/change-password?next=${encodeURIComponent(next)}` : next,
        { replace: true },
      )
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Sign-in failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-surface min-h-dvh px-4 py-8 sm:grid sm:place-items-center sm:px-6">
      <section className="glass-panel mx-auto w-full max-w-md rounded-[2rem] p-6 shadow-2xl shadow-black/40 sm:p-9">
        <div className="flex justify-center"><Logo /></div>
        <div className="mx-auto mt-8 grid size-14 place-items-center rounded-2xl bg-white text-zinc-950 shadow-lg shadow-white/10">
          <LockKeyhole aria-hidden="true" />
        </div>
        <div className="mt-5 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">Private library</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-400">Sign in with the account your administrator created.</p>
        </div>

        <form className="mt-7 space-y-5" onSubmit={submit}>
          <label className="block text-sm font-medium text-zinc-200">
            Username
            <input
              required
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="form-input mt-2"
            />
          </label>
          <label className="block text-sm font-medium text-zinc-200">
            Password
            <input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="form-input mt-2"
            />
          </label>
          {error && <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
          <button type="submit" disabled={submitting} className="primary-button w-full justify-center">
            {submitting ? 'Signing in…' : 'Sign in'}
            {!submitting && <ArrowRight size={18} aria-hidden="true" />}
          </button>
        </form>
      </section>
    </main>
  )
}
