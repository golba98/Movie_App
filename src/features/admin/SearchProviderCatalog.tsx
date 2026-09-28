import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { apiErrorMessage } from '../../lib/errors'
import type { SearchProvider, SearchProviderInput } from '../../types/media-source'
import { createAdminSearchProvider, deleteAdminSearchProvider, getAdminSearchProviders, updateAdminSearchProvider } from './api'
import { CatalogCard } from './ui/CatalogCard'
import { CatalogSection } from './ui/CatalogSection'
import { useAdminAction } from './useAdminAction'

const CREATE_KEY = 'create-provider'

const EMPTY_DRAFT: SearchProviderInput = {
  label: '',
  baseUrl: '',
  movieUrlPattern: '',
  tvUrlPattern: '',
  active: true,
}

function draftFromProvider({ label, baseUrl, movieUrlPattern, tvUrlPattern, active }: SearchProvider): SearchProviderInput {
  return { label, baseUrl, movieUrlPattern, tvUrlPattern, active }
}

function ProviderFields({ draft, onChange }: { draft: SearchProviderInput; onChange: (draft: SearchProviderInput) => void }) {
  const update = <Key extends keyof SearchProviderInput>(key: Key, value: SearchProviderInput[Key]) => onChange({ ...draft, [key]: value })

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <label className="text-sm text-zinc-300">Provider label
        <input required maxLength={160} value={draft.label} onChange={(event) => update('label', event.target.value)} className="form-input mt-2" placeholder="Flixbaba" />
      </label>
      <label className="text-sm text-zinc-300">Base URL
        <input required maxLength={500} value={draft.baseUrl} onChange={(event) => update('baseUrl', event.target.value)} className="form-input mt-2" placeholder="https://flixbaba.mov" />
      </label>
      <label className="text-sm text-zinc-300">Movie URL pattern
        <input
          maxLength={500}
          value={draft.movieUrlPattern}
          onChange={(event) => update('movieUrlPattern', event.target.value)}
          className="form-input mt-2"
          placeholder="{baseUrl}/movie/{tmdbId}/{slug}/watch"
        />
      </label>
      <label className="text-sm text-zinc-300">TV URL pattern
        <input
          maxLength={500}
          value={draft.tvUrlPattern}
          onChange={(event) => update('tvUrlPattern', event.target.value)}
          className="form-input mt-2"
          placeholder="{baseUrl}/tv/{tmdbId}/{slug}"
        />
      </label>
      <label className="inline-flex min-h-12 cursor-pointer items-center gap-3 text-sm font-medium md:col-span-2 xl:col-span-4">
        <input type="checkbox" checked={draft.active} onChange={(event) => update('active', event.target.checked)} className="size-5 accent-white" />
        Provider is active and used for video searches
      </label>
    </div>
  )
}

function ProviderCard({ provider, busy, onSave, onDelete }: {
  provider: SearchProvider
  busy: boolean
  onSave: (provider: SearchProvider, draft: SearchProviderInput) => void
  onDelete: (provider: SearchProvider) => void
}) {
  const [draft, setDraft] = useState(() => draftFromProvider(provider))

  useEffect(() => setDraft(draftFromProvider(provider)), [provider])

  return (
    <CatalogCard
      title={provider.label}
      subtitle={provider.baseUrl}
      active={provider.active}
      busy={busy}
      saveLabel="Save provider"
      onSave={() => onSave(provider, draft)}
      onDelete={() => onDelete(provider)}
    >
      <ProviderFields draft={draft} onChange={setDraft} />
    </CatalogCard>
  )
}

export function SearchProviderCatalog() {
  const [providers, setProviders] = useState<SearchProvider[]>([])
  const [draft, setDraft] = useState<SearchProviderInput>(EMPTY_DRAFT)
  const [loading, setLoading] = useState(true)
  const { busyId, error, notice, setError, setNotice, run } = useAdminAction('The provider request could not be completed.')

  const loadProviders = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await getAdminSearchProviders()
      setProviders(response.providers)
    } catch (caught) {
      setError(apiErrorMessage(caught, 'Failed to load search providers.'))
    } finally {
      setLoading(false)
    }
  }, [setError])

  useEffect(() => {
    void loadProviders()
  }, [loadProviders])

  const create = (event: FormEvent) => {
    event.preventDefault()
    void run(CREATE_KEY, async () => {
      const response = await createAdminSearchProvider(draft)
      setDraft(EMPTY_DRAFT)
      setNotice(`Added ${response.provider.label}.`)
      await loadProviders()
    }, 'Failed to create provider.')
  }

  const save = (provider: SearchProvider, updatedDraft: SearchProviderInput) => run(provider.id, async () => {
    const response = await updateAdminSearchProvider(provider.id, updatedDraft)
    setNotice(`Saved ${response.provider.label}.`)
    await loadProviders()
  }, 'Failed to update provider.')

  const remove = (provider: SearchProvider) => {
    if (!window.confirm(`Delete the search provider “${provider.label}”?`)) return
    void run(provider.id, async () => {
      await deleteAdminSearchProvider(provider.id)
      setNotice(`Deleted ${provider.label}.`)
      await loadProviders()
    }, 'Failed to delete provider.')
  }

  return (
    <CatalogSection
      id="search-providers-heading"
      title="Dynamic search providers"
      description="Configure websites where Fedora Movies will dynamically look up streams based on TMDB metadata."
      error={error}
      notice={notice}
      addTitle="Add search provider"
      addLabel="Add search provider"
      adding={busyId === CREATE_KEY}
      onAdd={create}
      addFields={<ProviderFields draft={draft} onChange={setDraft} />}
      listTitle="Configured search providers"
    >
      {loading ? (
        <p role="status" className="mt-5 text-sm text-zinc-400">Loading search providers…</p>
      ) : providers.length > 0 && (
        <div className="mt-5 grid gap-4">
          {providers.map((provider) => (
            <ProviderCard key={provider.id} provider={provider} busy={busyId === provider.id} onSave={save} onDelete={remove} />
          ))}
        </div>
      )}
    </CatalogSection>
  )
}
