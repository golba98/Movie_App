import { Users } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router'
import { errorMessage } from '../../lib/errors'
import { lookupWatchParty } from './api'

export function WatchPartyJoinPage() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const response = await lookupWatchParty(code)
      navigate(`/watch-party/${response.room.roomId}`)
    } catch (caught) {
      setError(errorMessage(caught, 'That room is unavailable.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-xl place-items-center px-4 py-10">
      <section className="glass-panel w-full rounded-3xl p-6 sm:p-8">
        <span className="grid size-12 place-items-center rounded-2xl bg-white text-zinc-950"><Users aria-hidden="true" /></span>
        <h1 className="mt-5 text-3xl font-black">Join Watch Party</h1>
        <p className="mt-2 leading-6 text-zinc-400">Enter a room code, then watch in sync. Use Discord or another app if you want to talk.</p>
        <form className="mt-7 space-y-4" onSubmit={submit}>
          <label className="block text-sm font-semibold">Room code
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              className="form-input mt-2 tracking-[0.2em] uppercase"
              required
              maxLength={12}
              autoFocus
            />
          </label>
          {error && <p role="alert" className="rounded-xl bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
          <button className="primary-button w-full justify-center" disabled={loading}>{loading ? 'Finding room…' : 'Continue'}</button>
        </form>
      </section>
    </main>
  )
}
