import { SELF } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { subtitleTarget } from '../catalog/subtitles'
import { activeViewerCookies, origin, request } from './helpers'

// Source 1 plays Breaking Bad S1E1 from a 1080p WEB-DL release, which has no
// subtitle tracks of its own, so the subtitle has to come from OpenSubtitles.
const EPISODE_PAGE = 'https://www.flixbaba.best/tv/1396/breaking-bad/season/1?e=1'
const EPISODE_PLAYER = 'https://vsembed.ru/embed/tv?tmdb=1396&season=1&episode=1'
const EPISODE_META = 'https://data.vidsrc.sh/api.php?type=tv&tmdb=1396&season=1&episode=1'
const EPISODE_SEARCH = 'https://rest.opensubtitles.org/search/episode-1/imdbid-0903747/season-1/sublanguageid-eng'
const EPISODE_RUNTIME = 'https://api.themoviedb.org/3/tv/1396/season/1/episode/1'
const WEB_DL_RELEASE = 'Breaking Bad COMPLETE S01-S05 1080p WEB-DL DD5 1 H 264 CARBoN/Breaking.Bad.S01E01.Pilot.1080p.WEB.DL.DD5.1.H.264.mkv'
const BUNDLED = 'https://vidapi.cloud/subs/912c3358'
const DOWNLOAD = 'https://dl.opensubtitles.org/en/download/src-api/vrf-1/filead'

type Upstream = Record<string, () => Response | Promise<Response>>

/** Answers outbound requests by URL prefix, longest first, and records every URL. */
function stubUpstream(routes: Upstream) {
  const calls: string[] = []
  const prefixes = Object.keys(routes).sort((a, b) => b.length - a.length)
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input)
    calls.push(url)
    const prefix = prefixes.find((candidate) => url.startsWith(candidate))
    // Anything else is the embed-policy probe of the player page.
    return prefix ? routes[prefix]() : new Response('<title>Player</title>')
  }))
  return calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
// Forty distinct lines across a 58-minute episode, the first at 2:14.
const LINES = [
  'My name is Walter Hartwell White.',
  ...Array.from({ length: 39 }, (_, i) => `Spoken line number ${[...String(i + 1)].map((digit) => DIGITS[Number(digit)]).join(' ')}.`),
]

function timestamp(seconds: number) {
  const ms = Math.round(seconds * 1000)
  const pad = (value: number, width = 2) => String(value).padStart(width, '0')
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`
}

/** An SRT file with LINES, every cue moved by `shift` seconds. */
function srt(shift = 0, lines = LINES) {
  return lines.map((text, i) => `${i + 1}\n${timestamp(134 + i * 80 + shift)} --> ${timestamp(136 + i * 80 + shift)}\n${text}`).join('\n\n')
}

async function gzip(content: string | Uint8Array<ArrayBuffer>) {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
  return new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
}

const download = (content: string | Uint8Array<ArrayBuffer>) => async () => new Response(await gzip(content))

function searchResult(fileId: number, fileName: string, overrides: Record<string, string> = {}) {
  return {
    IDSubtitleFile: String(fileId),
    SubFileName: fileName,
    SubDownloadLink: `${DOWNLOAD}/${fileId}.gz`,
    SubDownloadsCnt: '1000',
    SubEncoding: 'UTF-8',
    SubFormat: 'srt',
    SubLastTS: '00:54:16',
    MovieFPS: '23.976',
    SubBad: '0',
    SubAutoTranslation: '0',
    SubForeignPartsOnly: '0',
    SubHearingImpaired: '0',
    ...overrides,
  }
}

const meta = (fileName: string, defaultSubs: unknown[] = [], imdbId = 'tt0903747') => () => Response.json({
  status_code: '200',
  data: { title: 'Breaking Bad 2008', imdb_id: imdbId, file_name: fileName },
  default_subs: defaultSubs,
})

async function extract(cookie: string, page = EPISODE_PAGE) {
  const response = await request(`/api/media-sources/extract?url=${encodeURIComponent(page)}`, { cookie })
  expect(response.status).toBe(200)
  return (await response.json() as { data: { extractedUrl: string } }).data.extractedUrl
}

/** The subtitle URL handed to Source 1, checked to carry the English label. */
function subtitleUrlOf(playerUrl: string) {
  const url = new URL(playerUrl)
  expect(url.searchParams.get('sub_label')).toBe('English')
  expect(url.searchParams.get('sub_lang')).toBe('en')
  const subtitle = url.searchParams.get('sub_url')
  expect(subtitle).toMatch(/^https:\/\/fedora\.test\/api\/subtitles\/[0-9a-f-]{36}\.vtt$/)
  return new URL(subtitle!)
}

async function fetchSubtitle(subtitle: URL) {
  // The provider's frame fetches it cross-origin, without the viewer's cookie.
  const response = await SELF.fetch(`${origin}${subtitle.pathname}`, {
    headers: { Origin: 'https://cloudorchestranova.com' },
    redirect: 'manual',
  })
  expect(response.headers.get('access-control-allow-origin')).toBe('*')
  return response
}

describe('Source 1 subtitles', () => {
  it("hands Source 1 the release's own plain English track when it has one", async () => {
    const { viewer } = await activeViewerCookies()
    const calls = stubUpstream({
      [EPISODE_META]: meta(WEB_DL_RELEASE, [
        { lang: 'English-Forced', code: 'en', url: `${BUNDLED}/English-Forced.eng.srt` },
        { lang: 'English-SDH', code: 'en', url: `${BUNDLED}/English-SDH.eng.srt` },
        { lang: 'English', code: 'en', url: `${BUNDLED}/English.eng.srt` },
        { lang: 'Danish', code: 'da', url: `${BUNDLED}/Danish.dan.srt` },
      ]),
    })

    const playerUrl = await extract(viewer)
    expect(playerUrl.startsWith(`${EPISODE_PLAYER}&sub_url=`)).toBe(true)
    const response = await fetchSubtitle(subtitleUrlOf(playerUrl))
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(`${BUNDLED}/English.eng.srt`)
    expect(calls.some((url) => url.startsWith('https://rest.opensubtitles.org/'))).toBe(false)
  })

  it('falls back to the SDH track, never a forced one', async () => {
    const { viewer } = await activeViewerCookies()
    stubUpstream({
      [EPISODE_META]: meta(WEB_DL_RELEASE, [
        { lang: 'English-Forced', code: 'en', url: `${BUNDLED}/English-Forced.eng.srt` },
        { lang: 'English-SDH', code: 'en', url: `${BUNDLED}/English-SDH.eng.srt` },
      ]),
    })

    const response = await fetchSubtitle(subtitleUrlOf(await extract(viewer)))
    expect(response.headers.get('location')).toBe(`${BUNDLED}/English-SDH.eng.srt`)
  })

  it('rejects a wrong-show file and an out-of-sync copy, and picks the timing the other releases agree on', async () => {
    const { viewer } = await activeViewerCookies()
    const calls = stubUpstream({
      [EPISODE_META]: meta(WEB_DL_RELEASE),
      [EPISODE_RUNTIME]: () => Response.json({ runtime: 58 }),
      [EPISODE_SEARCH]: () => Response.json([
        // Filed under this episode with a real release name, but 2½ minutes of another show.
        searchResult(101, 'Breaking.Bad.S01E01.720p.HDTV.x264-BiA.srt', { SubDownloadsCnt: '395227', SubLastTS: '00:02:38', MovieFPS: '25.000' }),
        // Same release family as the stream, so it ranks first, but a minute late throughout.
        searchResult(102, 'Breaking.Bad.S01E01.1080p.WEB-DL.DD5.1.H.264-CtrlHD.srt', { SubDownloadsCnt: '900000' }),
        searchResult(103, 'Breaking.Bad.S01E01.720p.BluRay.X264-REWARD.srt', { SubDownloadsCnt: '135237' }),
        searchResult(104, 'Breaking.Bad.S01E01.720p.HDTV.x264-BiA.srt', { SubDownloadsCnt: '738532' }),
        searchResult(105, 'breaking.bad.s01e01.dvdrip.xvid-orpheus.srt', { SubDownloadsCnt: '1143483', MovieFPS: '23.980' }),
      ]),
      [`${DOWNLOAD}/102.gz`]: download(srt(60)),
      [`${DOWNLOAD}/103.gz`]: download(srt(0.2)),
      [`${DOWNLOAD}/104.gz`]: download(srt(-0.3)),
      [`${DOWNLOAD}/105.gz`]: download(srt(0)),
    })

    const response = await fetchSubtitle(subtitleUrlOf(await extract(viewer)))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/vtt; charset=utf-8')
    const vtt = await response.text()
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true)
    expect(vtt).toContain('00:02:14.000 --> 00:02:16.000\nMy name is Walter Hartwell White.')
    expect(calls).not.toContain(`${DOWNLOAD}/101.gz`)
  })

  it('never uses a file named for another episode', async () => {
    const { viewer } = await activeViewerCookies()
    const calls = stubUpstream({
      [EPISODE_META]: meta(WEB_DL_RELEASE),
      [EPISODE_RUNTIME]: () => Response.json({ runtime: 58 }),
      [EPISODE_SEARCH]: () => Response.json([
        searchResult(201, 'Breaking.Bad.S01E02.720p.HDTV.x264-BiA.srt', { SubDownloadsCnt: '2000000' }),
        searchResult(202, 'Breaking.Bad.S01E01.720p.BluRay.X264-REWARD.srt'),
      ]),
      [`${DOWNLOAD}/202.gz`]: download(srt()),
    })

    const vtt = await (await fetchSubtitle(subtitleUrlOf(await extract(viewer)))).text()
    expect(vtt).toContain('My name is Walter Hartwell White.')
    expect(calls).not.toContain(`${DOWNLOAD}/201.gz`)
  })

  it('converts Windows-1252 subtitles to UTF-8', async () => {
    const { viewer } = await activeViewerCookies()
    const windows1252: Record<string, number> = { '’': 0x92, '–': 0x96 }
    const text = srt(0, ['Café – it’s the pilot, Walter.', ...LINES.slice(1)])
    stubUpstream({
      [EPISODE_META]: meta(WEB_DL_RELEASE),
      [EPISODE_RUNTIME]: () => Response.json({ runtime: 58 }),
      [EPISODE_SEARCH]: () => Response.json([searchResult(301, 'Breaking.Bad.S01E01.720p.BluRay.X264-REWARD.srt', { SubEncoding: 'CP1252' })]),
      [`${DOWNLOAD}/301.gz`]: download(Uint8Array.from(text, (char) => windows1252[char] ?? char.charCodeAt(0))),
    })

    const vtt = await (await fetchSubtitle(subtitleUrlOf(await extract(viewer)))).text()
    expect(vtt).toContain('Café – it’s the pilot, Walter.')
  })

  it('searches a movie by its IMDb id alone', async () => {
    const { viewer } = await activeViewerCookies()
    const calls = stubUpstream({
      'https://data.vidsrc.sh/api.php?type=movie&tmdb=27205': meta('Inception (2010) [1080p]/Inception.2010.1080p.BrRip.x264.YIFY.mp4', [], 'tt1375666'),
      'https://api.themoviedb.org/3/movie/27205': () => Response.json({ runtime: 58 }),
      'https://rest.opensubtitles.org/search/imdbid-1375666/sublanguageid-eng': () => Response.json([
        searchResult(401, 'Inception.2010.1080p.BrRip.x264.YIFY.srt'),
      ]),
      [`${DOWNLOAD}/401.gz`]: download(srt()),
    })

    const playerUrl = await extract(viewer, 'https://www.flixbaba.best/movie/27205/inception/watch')
    expect(playerUrl.startsWith('https://vsembed.ru/embed/movie?tmdb=27205&sub_url=')).toBe(true)
    expect(calls).toContain('https://rest.opensubtitles.org/search/imdbid-1375666/sublanguageid-eng')
  })

  it('leaves Source 1 to choose when no subtitle exists, and remembers that for the episode', async () => {
    const { viewer } = await activeViewerCookies()
    const calls = stubUpstream({
      [EPISODE_META]: meta(WEB_DL_RELEASE),
      [EPISODE_RUNTIME]: () => Response.json({ runtime: 58 }),
      [EPISODE_SEARCH]: () => Response.json([]),
    })

    expect(await extract(viewer)).toBe(EPISODE_PLAYER)
    expect(await extract(viewer)).toBe(EPISODE_PLAYER)
    expect(calls.filter((url) => url === EPISODE_SEARCH)).toHaveLength(1)
  })

  it('still plays when the subtitle lookup fails', async () => {
    const { viewer } = await activeViewerCookies()
    stubUpstream({ [EPISODE_META]: () => new Response('Service unavailable', { status: 503 }) })

    expect(await extract(viewer)).toBe(EPISODE_PLAYER)
  })

  it('serves only subtitles it chose', async () => {
    const response = await request('/api/subtitles/00000000-0000-4000-8000-000000000000.vtt')
    expect(response.status).toBe(404)
  })

  it('handles only Source 1 players', () => {
    expect(subtitleTarget(EPISODE_PLAYER)).toEqual({ mediaType: 'tv', tmdbId: 1396, season: 1, episode: 1 })
    expect(subtitleTarget('https://vsembed.ru/embed/movie?tmdb=27205')).toEqual({ mediaType: 'movie', tmdbId: 27205, season: null, episode: null })
    expect(subtitleTarget('https://player.example.test/embed/tv?tmdb=1396&season=1&episode=1')).toBeNull()
    expect(subtitleTarget('https://vsembed.ru/embed/tv?tmdb=1396')).toBeNull()
  })
})
