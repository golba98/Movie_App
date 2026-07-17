import { type FormEvent, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { ApiClientError } from '../../api/client'
import { AuthError, AuthField, AuthFieldGroup, AuthLayout, AuthSubmitButton } from '../../components/auth/AuthLayout'
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
    <AuthLayout
      eyebrow="First sign-in"
      title="Choose your own password"
      subtitle="Replace the temporary password before opening the library."
      footer={
        <button type="button" onClick={() => void logout()} className="cursor-pointer text-zinc-500 transition-colors hover:text-white">
          Sign out instead
        </button>
      }
    >
      <form className="mt-8 space-y-4" onSubmit={submit}>
        <AuthFieldGroup>
          <AuthField
            id="temp-password"
            label="Temporary password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={setCurrentPassword}
          />
          <AuthField
            id="new-password"
            label="New password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            describedBy="password-help"
            value={newPassword}
            onChange={setNewPassword}
          />
          <AuthField
            id="confirm-password"
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={setConfirmPassword}
          />
        </AuthFieldGroup>

        <p id="password-help" className="px-2 text-[12px] leading-normal text-zinc-500">
          Use 12–128 characters. A password manager is recommended.
        </p>

        {error && <AuthError message={error} />}

        <AuthSubmitButton submitting={submitting} pendingLabel="Saving…">Save password and continue</AuthSubmitButton>
      </form>
    </AuthLayout>
  )
}
