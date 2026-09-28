import { Trash2 } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import type { ViewerAccount } from '../../types/account'
import { AdminDialog } from './ui/AdminDialog'

interface DeleteAccountDialogProps {
  account: ViewerAccount
  busy: boolean
  onClose: () => void
  onDelete: () => void
}

export function DeleteAccountDialog({ account, busy, onClose, onDelete }: DeleteAccountDialogProps) {
  const [confirmation, setConfirmation] = useState('')
  const confirmed = confirmation === account.username

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (confirmed) onDelete()
  }

  return (
    <AdminDialog labelledBy="delete-heading" describedBy="delete-description" onDismiss={onClose} onEscape={onClose}>
      <span className="grid size-12 place-items-center rounded-2xl bg-red-500 text-white short:hidden"><Trash2 aria-hidden="true" /></span>
      <h2 id="delete-heading" className="mt-5 text-2xl font-semibold short:mt-0">Delete {account.username}?</h2>
      <p id="delete-description" className="mt-2 text-sm leading-6 text-zinc-400">
        This permanently deletes the account, signs the viewer out everywhere, and removes their favourites and watch parties.
        This cannot be undone. To keep the data, disable the account instead.
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <label htmlFor="delete-account-confirmation" className="block text-sm text-zinc-300">
          Type <strong className="font-semibold text-white">{account.username}</strong> to confirm
          <input
            id="delete-account-confirmation"
            autoFocus
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            className="form-input mt-2"
          />
        </label>
        <div className="grid gap-3 min-[360px]:grid-cols-2">
          <button type="button" onClick={onClose} className="secondary-button justify-center">Cancel</button>
          <button type="submit" disabled={busy || !confirmed} className="danger-button justify-center whitespace-nowrap">
            {busy ? 'Deleting…' : 'Delete account'}
          </button>
        </div>
      </form>
    </AdminDialog>
  )
}
