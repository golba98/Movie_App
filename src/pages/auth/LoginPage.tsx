import { type FormEvent, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { ApiClientError } from '../../api/client'
import { AuthError, AuthField, AuthFieldGroup, AuthLayout, AuthSubmitButton } from '../../components/auth/AuthLayout'
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
    <AuthLayout
      eyebrow="Private Library"
      title="Sign in with Fedora ID"
      subtitle="Use your administrator-created credentials."
      footer={
        <a href="#" onClick={(event) => event.preventDefault()} className="font-normal text-zinc-400 hover:text-white hover:underline">
          Forgot Fedora ID or password?
        </a>
      }
    >
      <form className="mt-8 space-y-4" onSubmit={submit}>
        <AuthFieldGroup>
          <AuthField id="username" label="Username" autoComplete="username" value={username} onChange={setUsername} />
          <AuthField id="password" label="Password" type="password" autoComplete="current-password" value={password} onChange={setPassword} />
        </AuthFieldGroup>

        {error && <AuthError message={error} />}

        <AuthSubmitButton submitting={submitting} pendingLabel="Signing in…">Sign in</AuthSubmitButton>
      </form>
    </AuthLayout>
  )
}
