import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { mockDynamicShow, SOURCE_ONE_SUBTITLE } from './player'

/** Real media/text tracks, with the provider's reported initial-renderer fault simulated. */
export async function mockCaptionPlayer(page: Page, { ignoreSeek = false, movie = false, trackDelay = 0 } = {}) {
  await mockDynamicShow(page, (season, episode) => `${movie ? 'https://vsembed.ru/embed/movie?tmdb=1'
    : `https://vsembed.ru/embed/tv?tmdb=10&season=${season}&episode=${episode}`}&${SOURCE_ONE_SUBTITLE}`)
  if (movie) {
    await page.route('**/api/media-sources/movie/1', (route) => route.fulfill({ json: { data: { sources: [{
      id: 'movie-provider', mediaType: 'movie', tmdbId: 1, seasonNumber: null, episodeNumber: null,
      label: 'Flixbaba Stream (Dynamic)', sourceUrl: 'https://provider.test/movie/1', isDynamic: true,
      mimeType: 'video/mp4', rightsBasis: 'licensed',
    }] } } }))
  }
  const media = await readFile('tests/support/media/resume.webm')
  await page.route('https://media.test/resume.webm', (route) => {
    const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/)
    const start = range ? Number(range[1]) : 0
    const end = range?.[2] ? Math.min(Number(range[2]), media.length - 1) : media.length - 1
    return route.fulfill({ status: range ? 206 : 200, body: media.subarray(start, end + 1), contentType: 'video/webm', headers: {
      'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}),
    } })
  })
  await page.route('https://media.test/english.vtt', async (route) => {
    if (trackDelay) await new Promise((resolve) => setTimeout(resolve, trackDelay))
    await route.fulfill({ contentType: 'text/vtt', headers: { 'Access-Control-Allow-Origin': '*' }, body: `WEBVTT

00:00:00.000 --> 00:00:10.000
intro

00:13:00.000 --> 00:13:04.000
dialogue B

00:13:10.000 --> 00:13:15.000
dialogue C
` })
  })
  await page.route('https://vsembed.ru/**', (route) => route.fulfill({
    contentType: 'text/html', body: `<!doctype html><title>Caption player fixture</title>
      <video crossorigin="anonymous" preload="auto" src="https://media.test/resume.webm">
        <track kind="subtitles" label="English" srclang="en" src="https://media.test/english.vtt" default>
      </video>
      <p role="status" aria-label="Active caption"></p>
      <button id="back">Seek to intro</button><button id="forward">Seek to dialogue C</button>
      <button id="captions">Toggle captions</button><button id="switch">Switch English track</button>
      <script>
        const video = document.querySelector('video')
        const trackElement = document.querySelector('track')
        const output = document.querySelector('p')
        const start = Number(new URL(location.href).searchParams.get('startAt')) || 0
        let synced = !start, captions = true, initialized = false
        window.__commands = []
        function report(status) {
          parent.postMessage({ type: 'PLAYER_EVENT', data: {
            player_status: status, player_progress: video.currentTime, player_duration: video.duration,
            player_info: ${movie ? "{ tmdb: '1', mediaType: 'movie', season: null, episode: null }"
              : "{ tmdb: '10', mediaType: 'tv', season: Number(new URL(location.href).searchParams.get('season')), episode: Number(new URL(location.href).searchParams.get('episode')) }"}
          } }, '*')
        }
        function render() {
          output.textContent = !captions ? '' : !synced ? 'intro'
            : Array.from(video.textTracks[0].activeCues || []).map(cue => cue.text).join(' ')
        }
        function initialize() {
          if (initialized || video.readyState < 2 || !video.seekable.length || trackElement.readyState !== 2) return
          initialized = true
          video.textTracks[0].mode = 'hidden'
          video.currentTime = start
          video.addEventListener('seeked', () => { render(); report('seeked') })
          video.textTracks[0].addEventListener('cuechange', render)
          video.addEventListener('seeked', () => { render(); report('playing') }, { once: true })
          if (!start) { render(); report('playing') }
        }
        video.addEventListener('loadedmetadata', initialize)
        video.addEventListener('canplay', initialize)
        trackElement.addEventListener('load', initialize)
        addEventListener('message', event => {
          if (event.source !== parent || !event.data.player) return
          window.__commands.push(event.data)
          if (${ignoreSeek}) return
          const match = /^seek([0-9]+)$/.exec(event.data.action)
          if (match) { synced = true; video.currentTime = Number(match[1]) }
        })
        document.querySelector('#back').onclick = () => { synced = true; video.currentTime = 3 }
        document.querySelector('#forward').onclick = () => { synced = true; video.currentTime = 790 }
        document.querySelector('#captions').onclick = () => { captions = !captions; render() }
        document.querySelector('#switch').onclick = () => {
          const replacement = video.addTextTrack('subtitles', 'English alternative', 'en')
          replacement.addCue(new VTTCue(780, 784, 'alternative dialogue B'))
          replacement.mode = 'hidden'
          video.textTracks[0].mode = 'disabled'
          output.textContent = Array.from(replacement.activeCues || []).map(cue => cue.text).join(' ')
        }
      </script>`,
  }))
}
