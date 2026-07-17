import { KeyRound } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { ApiClientError } from '../../api/client'
import { Logo } from '../../components/layout/Logo'
import { useAuth } from '../../hooks/useAuth'

export function ChangePasswordPage() {
  const { account, changePassword, logout } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const nextValue = searchParams.get('next')
  const next = nextValue?.startsWith('/') && !nextValue.startsWith('//') ? nextValue : '/'

  if (!account) return <Navigate to="/login" replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await changePassword(currentPassword, newPassword)
      navigate(next === '/change-password' ? '/' : next, { replace: true })
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'The password could not be changed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-surface min-h-dvh px-4 py-8 sm:grid sm:place-items-center sm:px-6">
      <section className="glass-panel mx-auto w-full max-w-lg rounded-[2rem] p-6 sm:p-9">
        <div className="flex justify-center"><Logo /></div>
        <div className="mt-8 flex items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white text-zinc-950"><KeyRound aria-hidden="true" /></span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">First sign-in</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Choose your own password</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-400">Replace the temporary password before opening the library.</p>
          </div>
        </div>
        <form className="mt-7 space-y-5" onSubmit={submit}>
          <label className="block text-sm font-medium">Temporary password
            <input required type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="form-input mt-2" />
          </label>
          <label className="block text-sm font-medium">New password
            <input required minLength={12} maxLength={128} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="form-input mt-2" aria-describedby="password-help" />
          </label>
          <p id="password-help" className="-mt-3 text-xs text-zinc-500">Use 12–128 characters. A password manager is recommended.</p>
          <label className="block text-sm font-medium">Confirm new password
            <input required type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="form-input mt-2" />
          </label>
          {error && <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
          <button type="submit" disabled={submitting} className="primary-button w-full justify-center">{submitting ? 'Saving…' : 'Save password and continue'}</button>
        </form>
        <button type="button" onClick={() => void logout()} className="mt-5 min-h-11 w-full rounded-xl text-sm text-zinc-400 hover:text-white">Sign out instead</button>
      </section>
    </main>
  )
}
