import { UserPlus } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import type { NewAccountInput } from './api'
import { expiryValue, minExpiryDate } from './expiry'
import { PasswordInput } from './ui/PasswordInput'

const EMPTY_FORM = { username: '', displayName: '', temporaryPassword: '', expiresAt: '' }

interface CreateAccountFormProps {
  creating: boolean
  // Resolves true once the account exists, which clears the form.
  onCreate: (input: NewAccountInput) => Promise<boolean>
}

export function CreateAccountForm({ creating, onCreate }: CreateAccountFormProps) {
  const [form, setForm] = useState(EMPTY_FORM)
  const update = (key: keyof typeof EMPTY_FORM) => (value: string) => setForm((current) => ({ ...current, [key]: value }))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const created = await onCreate({
      username: form.username,
      displayName: form.displayName,
      temporaryPassword: form.temporaryPassword,
      expiresAt: expiryValue(form.expiresAt),
    })
    if (created) setForm(EMPTY_FORM)
  }

  return (
    <section aria-labelledby="create-account-heading" className="glass-panel mt-8 rounded-[2rem] p-5 sm:p-7">
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-2xl bg-white text-zinc-950"><UserPlus size={20} aria-hidden="true" /></span>
        <div>
          <h2 id="create-account-heading" className="text-xl font-semibold">Create viewer account</h2>
          <p className="text-sm text-zinc-500">Every new viewer must replace their temporary password.</p>
        </div>
      </div>
      <form onSubmit={submit} className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm text-zinc-300">Username
          <input
            required
            minLength={3}
            maxLength={32}
            pattern="[A-Za-z0-9._-]+"
            value={form.username}
            onChange={(event) => update('username')(event.target.value)}
            className="form-input mt-2"
          />
        </label>
        <label className="text-sm text-zinc-300">Display name
          <input required maxLength={80} value={form.displayName} onChange={(event) => update('displayName')(event.target.value)} className="form-input mt-2" />
        </label>
        <PasswordInput
          id="new-account-temporary-password"
          label="Temporary password"
          value={form.temporaryPassword}
          onChange={update('temporaryPassword')}
        />
        <label className="text-sm text-zinc-300">Expiry (optional)
          <input
            type="date"
            min={minExpiryDate()}
            value={form.expiresAt}
            onChange={(event) => update('expiresAt')(event.target.value)}
            className="form-input mt-2"
          />
        </label>
        <button type="submit" disabled={creating} className="primary-button justify-center md:col-span-2 xl:col-span-4">
          {creating ? 'Creating…' : 'Create account'}<UserPlus size={18} aria-hidden="true" />
        </button>
      </form>
    </section>
  )
}
