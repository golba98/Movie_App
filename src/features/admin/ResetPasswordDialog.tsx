import { KeyRound } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import type { ViewerAccount } from '../../types/account'
import { AdminDialog } from './ui/AdminDialog'
import { PasswordInput } from './ui/PasswordInput'

interface ResetPasswordDialogProps {
  account: ViewerAccount
  busy: boolean
  onClose: () => void
  onReset: (password: string) => void
}

export function ResetPasswordDialog({ account, busy, onClose, onReset }: ResetPasswordDialogProps) {
  const [password, setPassword] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onReset(password)
  }

  return (
    <AdminDialog labelledBy="reset-heading" onDismiss={onClose}>
      <span className="grid size-12 place-items-center rounded-2xl bg-amber-300 text-zinc-950"><KeyRound aria-hidden="true" /></span>
      <h2 id="reset-heading" className="mt-5 text-2xl font-semibold">Reset {account.username}</h2>
      <p className="mt-2 text-sm leading-6 text-zinc-400">
        This revokes every active session. The viewer must change the new temporary password at their next sign-in.
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <PasswordInput id="reset-account-temporary-password" label="New temporary password" autoFocus value={password} onChange={setPassword} />
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={onClose} className="secondary-button justify-center">Cancel</button>
          <button type="submit" disabled={busy} className="primary-button justify-center">Reset</button>
        </div>
      </form>
    </AdminDialog>
  )
}
