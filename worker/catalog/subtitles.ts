import type { MediaType } from '../../src/types/tmdb'
import { notFound } from '../http'
import { fetchTmdbRuntime } from './tmdb'

// Source 1's player (vsembed.ru) chooses its own subtitle unless it is given
// one: a track bundled with the release when there is one, otherwise the
// most-downloaded OpenSubtitles file for the title, whatever release, frame
// rate or even show that file was made for. Here the subtitle is chosen and
// checked instead, then handed to the player as `sub_url`, which it loads in
// place of its own pick.
const SUBTITLE_PLAYER_HOST = 'vsembed.ru'
// Source 1's own metadata API: the release it streams and its bundled tracks.
const PROVIDER_META_API = 'https://data.vidsrc.sh/api.php'
const SEARCH_API = 'https://rest.opensubtitles.org/search'
const SEARCH_USER_AGENT = 'FedoraMovies v1'
const DOWNLOAD_HOST = 'dl.opensubtitles.org'

// Keeps a slow lookup from holding up the player for long.
const LOOKUP_BUDGET_MS = 5_000
const MAX_DOWNLOADS = 4
const MAX_SUBTITLE_BYTES = 1_048_576
const MIN_CUES = 10
const CHOSEN_TTL_MS = 7 * 24 * 60 * 60 * 1_000
const MISSING_TTL_MS = 24 * 60 * 60 * 1_000
// A lookup that failed (timeout, provider down) is retried sooner than a real miss.
const FAILED_TTL_MS = 10 * 60 * 1_000

// A file must end between 60% of the runtime and ten minutes past it.
const MIN_RUNTIME_SHARE = 0.6
const RUNTIME_SLACK_SECONDS = 600
// Two copies agree when most lines they share start within 1.5 s of each other.
// Copies of different releases of the same cut agree on 98-100% of their lines;
// a shifted copy, a frame-rate drift or another show agrees on almost none.
const AGREE_SECONDS = 1.5
const AGREE_SHARE = 0.8
const MIN_SHARED_LINES = 20

// Lines OpenSubtitles inserts to advertise itself.
const ADVERT = /opensubtitles|osdb\.link|advertise your product|become vip/i

const RELEASE_FAMILIES: [family: string, pattern: RegExp][] = [
  ['bluray', /blu-?ray|bd-?rip|br-?rip|bdremux/i],
  ['web', /\bweb(?:[ ._-]?(?:dl|rip))?\b|\b(?:amzn|atvp|dsnp|hmax|nf)\b/i],
  ['hdtv', /\b(?:hdtv|pdtv)\b/i],
  ['dvd', /\bdvd(?:rip|scr)?\b/i],
]

export interface SubtitleTarget {
  mediaType: MediaType
  tmdbId: number
  season: number | null
  episode: number | null
}

interface Cue {
  start: number
  end: number
  text: string
}

type Choice = { url: string } | { body: string }

interface ProviderMeta {
  data?: { imdb_id?: unknown; file_name?: unknown }
  default_subs?: unknown
}

interface SearchResult {
  SubFileName?: string
  SubDownloadLink?: string
  SubDownloadsCnt?: string
  SubEncoding?: string
  SubFormat?: string
  SubLastTS?: string
  SubBad?: string
  SubAutoTranslation?: string
  SubForeignPartsOnly?: string
  SubHearingImpaired?: string
}

interface Candidate {
  link: string
  encoding: string
  score: number
  downloads: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const positiveInteger = (value: string | null) => (value && /^[1-9]\d*$/.test(value) ? Number(value) : null)

/** The title or episode a Source 1 player URL plays, or null for any other player. */
export function subtitleTarget(playerUrl: string): SubtitleTarget | null {
  let url: URL
  try {
    url = new URL(playerUrl)
  } catch {
    return null
  }
  if (url.hostname.replace(/^www\./, '') !== SUBTITLE_PLAYER_HOST) return null
  const tmdbId = positiveInteger(url.searchParams.get('tmdb'))
  if (!tmdbId) return null
  if (url.pathname === '/embed/movie') return { mediaType: 'movie', tmdbId, season: null, episode: null }
  if (url.pathname !== '/embed/tv') return null
  const season = positiveInteger(url.searchParams.get('season'))
  const episode = positiveInteger(url.searchParams.get('episode'))
  return season && episode ? { mediaType: 'tv', tmdbId, season, episode } : null
}

/** The player URL with a checked English subtitle attached, or unchanged when there is none. */
export async function withSubtitle(env: Env, playerUrl: string, appOrigin: string) {
  const target = subtitleTarget(playerUrl)
  if (!target) return playerUrl
  try {
    const id = await subtitleIdFor(env, target)
    if (!id) return playerUrl
    const url = new URL(playerUrl)
    url.searchParams.set('sub_url', `${appOrigin}/api/subtitles/${id}.vtt`)
    url.searchParams.set('sub_label', 'English')
    url.searchParams.set('sub_lang', 'en')
    return url.href
  } catch (error) {
    console.warn('Subtitle cache failed', { tmdbId: target.tmdbId, reason: error instanceof Error ? error.message : 'unknown' })
    return playerUrl
  }
}

/**
 * Serves a chosen subtitle to the provider's frame, which fetches it
 * cross-origin and without cookies. Only subtitles chosen during an
 * authenticated extraction exist, so this never fetches anything itself.
 */
export async function serveSubtitle(env: Env, id: string) {
  const row = await env.DB
    .prepare('SELECT body, url FROM subtitle_cache WHERE id = ?')
    .bind(id)
    .first<{ body: string | null; url: string | null }>()
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
  }
  if (row?.url) return new Response(null, { status: 302, headers: { ...headers, Location: row.url } })
  if (row?.body) return new Response(row.body, { headers: { ...headers, 'Content-Type': 'text/vtt; charset=utf-8' } })
  return notFound()
}

const cacheKey = (target: SubtitleTarget) =>
  [target.mediaType, target.tmdbId, target.season ?? '', target.episode ?? '', 'en'].join(':')

// Misses are cached too, so a title without subtitles isn't searched on every play.
async function subtitleIdFor(env: Env, target: SubtitleTarget) {
  const key = cacheKey(target)
  const cached = await env.DB
    .prepare('SELECT id, body IS NOT NULL OR url IS NOT NULL AS usable FROM subtitle_cache WHERE key = ? AND expires_at > ?')
    .bind(key, Date.now())
    .first<{ id: string; usable: number }>()
  if (cached) return cached.usable ? cached.id : null

  let choice: Choice | null = null
  let ttl = MISSING_TTL_MS
  try {
    choice = await chooseSubtitle(env, target, AbortSignal.timeout(LOOKUP_BUDGET_MS))
    if (choice) ttl = CHOSEN_TTL_MS
  } catch (error) {
    console.warn('Subtitle lookup failed', { tmdbId: target.tmdbId, reason: error instanceof Error ? error.message : 'unknown' })
    ttl = FAILED_TTL_MS
  }

  // The id survives a re-pick, so a player already holding it keeps working.
  const now = Date.now()
  const row = await env.DB
    .prepare(
      `INSERT INTO subtitle_cache (key, id, body, url, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET body = excluded.body, url = excluded.url, expires_at = excluded.expires_at
       RETURNING id`,
    )
    .bind(key, crypto.randomUUID(), choice && 'body' in choice ? choice.body : null, choice && 'url' in choice ? choice.url : null, now + ttl, now)
    .first<{ id: string }>()
  return choice ? row?.id ?? null : null
}

/**
 * The release's own English track when it has one, as those always match it.
 * Otherwise the OpenSubtitles file whose timing the other uploads agree with,
 * among those that are for this episode and the right length.
 */
async function chooseSubtitle(env: Env, target: SubtitleTarget, signal: AbortSignal): Promise<Choice | null> {
  const meta = await providerMeta(target, signal)
  const bundled = bundledEnglishTrack(meta.default_subs)
  if (bundled) return { url: bundled }

  const imdbId = typeof meta.data?.imdb_id === 'string' ? meta.data.imdb_id.match(/^tt(\d+)$/)?.[1] : undefined
  if (!imdbId) return null
  const [results, runtimeMinutes] = await Promise.all([
    searchOpenSubtitles(imdbId, target, signal),
    fetchTmdbRuntime(env, target, signal).catch(() => null),
  ])
  const releaseName = typeof meta.data?.file_name === 'string' ? meta.data.file_name : ''
  const candidates = rankCandidates(results, target, releaseName, runtimeMinutes ? runtimeMinutes * 60 : null)

  const copies = await Promise.all(candidates.slice(0, MAX_DOWNLOADS).map((candidate) => downloadCues(candidate, signal).catch(() => null)))
  // Out of time: a failed lookup, not a title without subtitles.
  if (signal.aborted) throw new Error('Subtitle lookup timed out')
  const cues = agreedCopy(copies.filter((copy): copy is Cue[] => copy !== null && copy.length >= MIN_CUES))
  return cues ? { body: toWebVtt(cues) } : null
}

async function providerMeta(target: SubtitleTarget, signal: AbortSignal): Promise<ProviderMeta> {
  const url = new URL(PROVIDER_META_API)
  url.searchParams.set('type', target.mediaType)
  url.searchParams.set('tmdb', String(target.tmdbId))
  if (target.season && target.episode) {
    url.searchParams.set('season', String(target.season))
    url.searchParams.set('episode', String(target.episode))
  }
  const response = await fetch(url.href, { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Provider metadata returned ${response.status}`)
  const meta: unknown = await response.json()
  return isRecord(meta) ? meta : {}
}

// Plain English over SDH (which adds sound descriptions); never a forced track,
// which only covers foreign-language dialogue.
function bundledEnglishTrack(tracks: unknown) {
  if (!Array.isArray(tracks)) return null
  const english = tracks.filter((track): track is { lang: string; url: string } => (
    isRecord(track)
    && typeof track.lang === 'string'
    && typeof track.url === 'string'
    && track.url.startsWith('https://')
    && (track.code === 'en' || /^english/i.test(track.lang))
    && !/forced/i.test(`${track.lang} ${track.url}`)
  ))
  const plain = english.find((track) => !/\b(?:sdh|hi)\b|hearing/i.test(track.lang))
  return (plain ?? english[0])?.url ?? null
}

async function searchOpenSubtitles(imdbId: string, target: SubtitleTarget, signal: AbortSignal): Promise<SearchResult[]> {
  const path = target.mediaType === 'tv'
    ? `episode-${target.episode}/imdbid-${imdbId}/season-${target.season}`
    : `imdbid-${imdbId}`
  const response = await fetch(`${SEARCH_API}/${path}/sublanguageid-eng`, { signal, headers: { 'X-User-Agent': SEARCH_USER_AGENT } })
  if (!response.ok) throw new Error(`OpenSubtitles search returned ${response.status}`)
  const results: unknown = await response.json()
  return Array.isArray(results) ? results.filter(isRecord) as SearchResult[] : []
}

function releaseFamily(name: string) {
  return RELEASE_FAMILIES.find(([, pattern]) => pattern.test(name))?.[0] ?? null
}

function namesOtherEpisode(name: string, target: SubtitleTarget) {
  const match = name.match(/s(\d{1,2})[ ._-]?e(\d{1,3})/i) ?? name.match(/\b(\d{1,2})x(\d{2,3})\b/i)
  return match !== null && (Number(match[1]) !== target.season || Number(match[2]) !== target.episode)
}

function downloadLink(value: string | undefined) {
  try {
    const url = new URL(value ?? '')
    return url.protocol === 'https:' && url.hostname === DOWNLOAD_HOST ? url.href : null
  } catch {
    return null
  }
}

function median(values: number[]) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * Drops files flagged bad, machine-translated, forced-only, named for another
 * episode, or whose last line is nowhere near the end of the episode (the
 * search reports it, so they are never downloaded). The rest are ordered by
 * release family, then plain over hearing-impaired, then downloads.
 */
function rankCandidates(results: SearchResult[], target: SubtitleTarget, releaseName: string, runtimeSeconds: number | null): Candidate[] {
  const lastLines = results.map((result) => clock(result.SubLastTS ?? '')).filter((seconds): seconds is number => seconds !== null && seconds > 0)
  // Without a runtime, the typical length of the uploads stands in for it.
  const expected = runtimeSeconds ?? median(lastLines)
  const family = releaseFamily(releaseName)

  return results
    .flatMap((result) => {
      const name = result.SubFileName ?? ''
      const link = downloadLink(result.SubDownloadLink)
      const lastLine = clock(result.SubLastTS ?? '')
      if (!link || result.SubFormat?.toLowerCase() !== 'srt') return []
      if (result.SubBad === '1' || result.SubAutoTranslation === '1' || result.SubForeignPartsOnly === '1') return []
      if (target.episode !== null && namesOtherEpisode(name, target)) return []
      if (expected && lastLine !== null && (lastLine < expected * MIN_RUNTIME_SHARE || lastLine > expected + RUNTIME_SLACK_SECONDS)) return []
      const score = (family && releaseFamily(name) === family ? 2 : 0) + (result.SubHearingImpaired === '1' ? 0 : 1)
      return [{ link, encoding: result.SubEncoding ?? 'UTF-8', score, downloads: Number(result.SubDownloadsCnt) || 0 }]
    })
    .sort((a, b) => b.score - a.score || b.downloads - a.downloads)
}

async function readCapped(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_SUBTITLE_BYTES) {
        await reader.cancel()
        throw new Error('Subtitle file too large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function decode(bytes: Uint8Array, encoding: string) {
  try {
    return new TextDecoder(encoding.toLowerCase()).decode(bytes)
  } catch {
    // An encoding this runtime doesn't know.
    return new TextDecoder().decode(bytes)
  }
}

// OpenSubtitles serves every file gzipped, in the encoding it was uploaded in.
async function downloadCues(candidate: Candidate, signal: AbortSignal) {
  const response = await fetch(candidate.link, { signal })
  if (!response.ok || !response.body) throw new Error(`Subtitle download returned ${response.status}`)
  const bytes = await readCapped(response.body.pipeThrough(new DecompressionStream('gzip')))
  return parseSubRip(decode(bytes, candidate.encoding))
}

function clock(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})(?:[,.](\d{1,3}))?/)
  if (!match) return null
  const [, hours, minutes, seconds, fraction = '0'] = match
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(fraction.padEnd(3, '0')) / 1000
}

function parseSubRip(text: string): Cue[] {
  const cues: Cue[] = []
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    const lines = block.split('\n')
    const timing = lines.findIndex((line) => line.includes('-->'))
    if (timing === -1) continue
    const [from, to] = lines[timing].split('-->')
    const start = clock(from)
    const end = clock(to)
    const cueText = lines.slice(timing + 1).join('\n').trim()
    if (start === null || end === null || end < start || !cueText || ADVERT.test(cueText)) continue
    cues.push({ start, end, text: cueText })
  }
  return cues.sort((a, b) => a.start - b.start)
}

const normalise = (text: string) => text.toLowerCase().replace(/<[^>]*>/g, ' ').replace(/[^a-z]+/g, ' ').trim()

// Each line of three or more words that appears once, mapped to when it starts.
function distinctLines(cues: Cue[]) {
  const starts = new Map<string, number | null>()
  for (const cue of cues) {
    const line = normalise(cue.text)
    if (line.split(' ').length < 3) continue
    starts.set(line, starts.has(line) ? null : cue.start)
  }
  return starts
}

function agree(a: Map<string, number | null>, b: Map<string, number | null>) {
  let shared = 0
  let close = 0
  for (const [line, start] of a) {
    const other = b.get(line)
    if (start == null || other == null) continue
    shared += 1
    if (Math.abs(start - other) <= AGREE_SECONDS) close += 1
  }
  return shared >= MIN_SHARED_LINES && close / shared >= AGREE_SHARE
}

/**
 * The copy that agrees with the most others, so a copy timed for another
 * cut or frame rate loses to the copies that match each other. Ties, and
 * copies with nothing to agree with, go to the highest-ranked.
 */
function agreedCopy(copies: Cue[][]) {
  if (copies.length === 0) return null
  const lines = copies.map(distinctLines)
  const support = lines.map((own, i) => lines.filter((other, j) => i !== j && agree(own, other)).length)
  return copies[support.indexOf(Math.max(...support))]
}

function vttClock(seconds: number) {
  const ms = Math.round(seconds * 1000)
  const pad = (value: number, width = 2) => String(value).padStart(width, '0')
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`
}

function toWebVtt(cues: Cue[]) {
  return `WEBVTT\n\n${cues.map((cue) => `${vttClock(cue.start)} --> ${vttClock(cue.end)}\n${cue.text.replace(/-->/g, '→')}`).join('\n\n')}\n`
}
