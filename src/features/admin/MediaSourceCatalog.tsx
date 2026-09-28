import { Search } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { apiErrorMessage } from '../../lib/errors'
import type { AdminMediaSource, MediaMimeType, MediaSourceInput, RightsBasis } from '../../types/media-source'
import type { MediaType } from '../../types/tmdb'
import { createAdminMediaSource, deleteAdminMediaSource, getAdminMediaSources, updateAdminMediaSource } from './api'
import { CatalogCard } from './ui/CatalogCard'
import { CatalogSection } from './ui/CatalogSection'
import { useAdminAction } from './useAdminAction'

const FALLBACK_ERROR = 'The media-source request could not be completed.'
const CREATE_KEY = 'create-media-source'

// Form state keeps numbers as strings so fields can be empty while editing.
interface SourceDraft {
  mediaType: MediaType
  tmdbId: string
  seasonNumber: string
  episodeNumber: string
  label: string
  sourceUrl: string
  mimeType: MediaMimeType
  rightsBasis: RightsBasis
  rightsNote: string
  active: boolean
}

const EMPTY_DRAFT: SourceDraft = {
  mediaType: 'movie',
  tmdbId: '',
  seasonNumber: '',
  episodeNumber: '',
  label: '',
  sourceUrl: '',
  mimeType: 'video/mp4',
  rightsBasis: 'owned',
  rightsNote: '',
  active: true,
}

function draftFromSource(source: AdminMediaSource): SourceDraft {
  return {
    mediaType: source.mediaType,
    tmdbId: String(source.tmdbId),
    seasonNumber: source.seasonNumber === null ? '' : String(source.seasonNumber),
    episodeNumber: source.episodeNumber === null ? '' : String(source.episodeNumber),
    label: source.label,
    sourceUrl: source.sourceUrl,
    mimeType: source.mimeType,
    rightsBasis: source.rightsBasis,
    rightsNote: source.rightsNote,
    active: source.active,
  }
}

function inputFromDraft(draft: SourceDraft): MediaSourceInput {
  const isTv = draft.mediaType === 'tv'
  return {
    mediaType: draft.mediaType,
    tmdbId: Number(draft.tmdbId),
    seasonNumber: isTv ? Number(draft.seasonNumber) : null,
    episodeNumber: isTv ? Number(draft.episodeNumber) : null,
    label: draft.label,
    sourceUrl: draft.sourceUrl,
    mimeType: draft.mimeType,
    rightsBasis: draft.rightsBasis,
    rightsNote: draft.rightsNote,
    active: draft.active,
  }
}

function SourceFields({ draft, onChange }: { draft: SourceDraft; onChange: (draft: SourceDraft) => void }) {
  const update = <Key extends keyof SourceDraft>(key: Key, value: SourceDraft[Key]) => onChange({ ...draft, [key]: value })
  const isMovie = draft.mediaType === 'movie'

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <label className="text-sm text-zinc-300">Media type
        <select value={draft.mediaType} onChange={(event) => update('mediaType', event.target.value as MediaType)} className="form-input mt-2">
          <option value="movie">Movie</option>
          <option value="tv">TV episode</option>
        </select>
      </label>
      <label className="text-sm text-zinc-300">TMDB ID
        <input required type="number" min="1" value={draft.tmdbId} onChange={(event) => update('tmdbId', event.target.value)} className="form-input mt-2" />
      </label>
      <label className="text-sm text-zinc-300">Season
        <input
          required={!isMovie}
          disabled={isMovie}
          type="number"
          min="1"
          value={draft.seasonNumber}
          onChange={(event) => update('seasonNumber', event.target.value)}
          className="form-input mt-2 disabled:opacity-40"
        />
      </label>
      <label className="text-sm text-zinc-300">Episode
        <input
          required={!isMovie}
          disabled={isMovie}
          type="number"
          min="1"
          value={draft.episodeNumber}
          onChange={(event) => update('episodeNumber', event.target.value)}
          className="form-input mt-2 disabled:opacity-40"
        />
      </label>
      <label className="text-sm text-zinc-300 md:col-span-2">Display label
        <input
          required
          maxLength={160}
          value={draft.label}
          onChange={(event) => update('label', event.target.value)}
          className="form-input mt-2"
          placeholder="Owned presentation master"
        />
      </label>
      <label className="text-sm text-zinc-300 md:col-span-2">Direct media URL
        <input
          required
          maxLength={2000}
          value={draft.sourceUrl}
          onChange={(event) => update('sourceUrl', event.target.value)}
          className="form-input mt-2"
          placeholder="/media/example.mp4 or https://media.example/video.mp4"
        />
      </label>
      <label className="text-sm text-zinc-300">Media format
        <select value={draft.mimeType} onChange={(event) => update('mimeType', event.target.value as MediaMimeType)} className="form-input mt-2">
          <option value="video/mp4">MP4</option>
          <option value="video/webm">WebM</option>
        </select>
      </label>
      <label className="inline-flex min-h-12 cursor-pointer items-center gap-3 text-sm font-medium md:col-span-3 xl:col-span-3">
        <input type="checkbox" checked={draft.active} onChange={(event) => update('active', event.target.checked)} className="size-5 accent-white" />
        Source is active and may be shown to signed-in viewers
      </label>
    </div>
  )
}

function SourceCard({ source, busy, onSave, onDelete }: {
  source: AdminMediaSource
  busy: boolean
  onSave: (source: AdminMediaSource, draft: SourceDraft) => void
  onDelete: (source: AdminMediaSource) => void
}) {
  const [draft, setDraft] = useState(() => draftFromSource(source))

  useEffect(() => setDraft(draftFromSource(source)), [source])

  const placement = source.mediaType === 'movie' ? 'Movie' : `TV S${source.seasonNumber} E${source.episodeNumber}`
  return (
    <CatalogCard
      title={source.label}
      subtitle={`${placement} · TMDB ${source.tmdbId}`}
      active={source.active}
      busy={busy}
      saveLabel="Save source"
      onSave={() => onSave(source, draft)}
      onDelete={() => onDelete(source)}
    >
      <SourceFields draft={draft} onChange={setDraft} />
    </CatalogCard>
  )
}

export function MediaSourceCatalog() {
  const [sources, setSources] = useState<AdminMediaSource[]>([])
  const [draft, setDraft] = useState<SourceDraft>(EMPTY_DRAFT)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const { busyId, error, notice, setError, setNotice, run } = useAdminAction(FALLBACK_ERROR)

  const loadSources = useCallback(async (query = '') => {
    setLoading(true)
    setError(null)
    try {
      const response = await getAdminMediaSources(query)
      setSources(response.sources)
    } catch (caught) {
      setError(apiErrorMessage(caught, FALLBACK_ERROR))
    } finally {
      setLoading(false)
    }
  }, [setError])

  useEffect(() => {
    void loadSources()
  }, [loadSources])

  const create = (event: FormEvent) => {
    event.preventDefault()
    void run(CREATE_KEY, async () => {
      const response = await createAdminMediaSource(inputFromDraft(draft))
      setDraft(EMPTY_DRAFT)
      setNotice(`Added ${response.source.label}. Only the direct media URL is sent to viewers.`)
      await loadSources(search)
    })
  }

  const save = (source: AdminMediaSource, updatedDraft: SourceDraft) => run(source.id, async () => {
    const response = await updateAdminMediaSource(source.id, inputFromDraft(updatedDraft))
    setNotice(`Saved ${response.source.label}.`)
    await loadSources(search)
  })

  const remove = (source: AdminMediaSource) => {
    if (!window.confirm(`Delete the authorised source “${source.label}”?`)) return
    void run(source.id, async () => {
      await deleteAdminMediaSource(source.id)
      setNotice(`Deleted ${source.label}.`)
      await loadSources(search)
    })
  }

  return (
    <CatalogSection
      id="media-sources-heading"
      title="Authorised media catalog"
      description="Map movies and TV episodes to direct owned or licensed MP4/WebM files. Fedora Movies never proxies the file or embeds a streaming website."
      count={sources.length}
      error={error}
      notice={notice}
      addTitle="Add direct source"
      addLabel="Add authorised source"
      adding={busyId === CREATE_KEY}
      onAdd={create}
      addFields={<SourceFields draft={draft} onChange={setDraft} />}
      listTitle="Configured sources"
      listActions={
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void loadSources(search)
          }}
          className="relative w-full sm:w-80"
        >
          <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} aria-hidden="true" />
          <input
            type="search"
            aria-label="Search authorised media"
            placeholder="Search title or TMDB ID"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="form-input pl-11"
          />
        </form>
      }
    >
      {loading ? (
        <p role="status" className="mt-5 text-sm text-zinc-400">Loading authorised sources…</p>
      ) : sources.length > 0 && (
        <div className="mt-5 grid gap-4">
          {sources.map((source) => (
            <SourceCard key={source.id} source={source} busy={busyId === source.id} onSave={save} onDelete={remove} />
          ))}
        </div>
      )}
    </CatalogSection>
  )
}
