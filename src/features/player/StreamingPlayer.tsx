import { AlertCircle, Minimize2, RotateCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MediaSource } from '../../types/media-source'
import type { MediaItem, MediaType } from '../../types/tmdb'
import { useWatchedHistory } from '../watch-history/watch-history-context'
import { withStartTime } from './episodes'
import { useEpisodeSelection } from './hooks/useEpisodeSelection'
import { useSourcePlayback } from './hooks/useSourcePlayback'
import { useTheaterFullscreen } from './hooks/useTheaterFullscreen'
import { useTheaterMode } from './hooks/useTheaterMode'
import { useVideoDiagnostics } from './hooks/useVideoDiagnostics'
import { useWatchProgress } from './hooks/useWatchProgress'
import { DynamicPlayerStage, type DynamicStage } from './parts/DynamicPlayerStage'
import { EmptyPlayer } from './parts/EmptyPlayer'
import { EpisodeSidebar } from './parts/EpisodeSidebar'
import { NativeVideoPlayer } from './parts/NativeVideoPlayer'
import { PlayerToolbar } from './parts/PlayerToolbar'
import { SourceSwitcher } from './parts/SourceSwitcher'
import { episodeListings, getSourceLabel, playableSourcesFor } from './sources'

const THEATER_BUTTON = 'absolute top-4 z-20 grid size-11 place-items-center rounded-full bg-black/70 text-zinc-200 ring-1 ring-white/15 backdrop-blur transition hover:bg-black/90 hover:text-white'

interface StreamingPlayerProps {
  id: number
  mediaType: MediaType
  title: string
  media: MediaItem
  numberOfSeasons?: number | null
  // Movie runtime in minutes; episode runtimes come from the season details.
  runtime?: number | null
  sources: MediaSource[]
  theaterMode: boolean
  onTheaterModeChange: (open: boolean) => void
}

export function StreamingPlayer({
  id,
  mediaType,
  title,
  media,
  numberOfSeasons,
  runtime,
  sources,
  theaterMode,
  onTheaterModeChange,
}: StreamingPlayerProps) {
  const isTv = mediaType === 'tv'
  const { isEpisodeWatched, toggleEpisodeWatched } = useWatchedHistory()
  const selection = useEpisodeSelection(id, mediaType, sources, numberOfSeasons)
  const { season, episode } = selection

  const [inlinePlaybackRequested, setInlinePlaybackRequested] = useState(false)
  const [mediaError, setMediaError] = useState<{ sourceId: string; message: string } | null>(null)
  const [videoPlaying, setVideoPlaying] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const playerShellRef = useRef<HTMLDivElement>(null)
  const exitButtonRef = useRef<HTMLButtonElement>(null)

  const playbackRequested = theaterMode || inlinePlaybackRequested
  const resetKey = `${id}:${season}:${episode}`
  const playableSources = useMemo(
    () => playableSourcesFor(sources, mediaType, season, episode),
    [sources, mediaType, season, episode],
  )
  const playback = useSourcePlayback({ playableSources, resetKey, playbackRequested })
  const { activeSource, activeState, isDynamic, iframeKey, iframeLoaded } = playback
  const playsNative = !isDynamic || (playbackRequested && activeState?.status === 'ready' && playback.playbackKind !== 'embed')

  useEffect(() => {
    setInlinePlaybackRequested(false)
  }, [resetKey])

  const exitTheater = useCallback(() => onTheaterModeChange(false), [onTheaterModeChange])
  useTheaterMode(theaterMode, exitTheater, exitButtonRef)
  useTheaterFullscreen(theaterMode, playerShellRef, videoRef, exitTheater)
  useVideoDiagnostics(videoRef, `player:${mediaType}:${id}`, activeSource?.sourceUrl ?? '')

  const runtimeMinutes = isTv
    ? selection.episodes.find((item) => item.season_number === season && item.episode_number === episode)?.runtime
    : runtime
  const progress = useWatchProgress({
    media,
    seasonNumber: isTv ? season : null,
    episodeNumber: isTv ? episode : null,
    runtimeMinutes,
    active: playsNative ? videoPlaying : playbackRequested && iframeLoaded,
    iframeRef,
  })

  const listings = useMemo(
    () => episodeListings(sources, selection.episodes, id, season),
    [sources, selection.episodes, id, season],
  )

  if (!activeSource) return <EmptyPlayer />

  const sourceLabel = getSourceLabel(activeSource)
  const currentMediaError = mediaError?.sourceId === activeSource.id
    ? mediaError.message
    : playsNative && activeState?.status === 'failed'
      ? activeState.message
      : null
  const showsIframe = isDynamic && playbackRequested && Boolean(playback.extractedUrl && iframeKey)
  // Only real media keeps a fixed 16:9 box on phones; the idle, preparing and
  // failed panels are taller than a phone-width 16:9 box and would be clipped.
  const showsMedia = playsNative || showsIframe

  let stage: DynamicStage
  if (!playbackRequested) stage = { kind: 'idle' }
  else if (playback.extractedUrl && iframeKey) stage = { kind: 'frame', iframeKey, url: playback.extractedUrl, loaded: iframeLoaded }
  else if (activeState?.status === 'failed') stage = { kind: 'failed', message: activeState.message }
  else stage = { kind: 'preparing' }

  const stopPlayback = () => setInlinePlaybackRequested(false)

  // The provider's own buffering spinner lives inside its cross-origin frame,
  // where we can't clear it; reloading the frame at the last saved position is
  // the way out when it sticks. Save first so it resumes from the latest point.
  const reloadPlayer = () => {
    progress.flush()
    playback.reloadPlayer()
  }

  return (
    <section id="streaming-player" className="scroll-mt-20" aria-labelledby="player-heading">
      <div className={`grid grid-cols-1 gap-6 ${theaterMode || !isTv ? '' : 'lg:grid-cols-[minmax(0,1fr)_320px]'}`}>
        <div className="min-w-0">
          <PlayerToolbar
            heading={`${title}${isTv ? ` — S${season} E${episode}` : ''}`}
            onReload={showsIframe && !theaterMode ? reloadPlayer : undefined}
            onStop={isDynamic && inlinePlaybackRequested && !theaterMode ? stopPlayback : undefined}
            onTheater={() => onTheaterModeChange(true)}
          />

          {playableSources.length > 1 && (
            <SourceSwitcher
              sources={playableSources}
              activeSourceId={activeSource.id}
              onSelect={(sourceId) => {
                stopPlayback()
                playback.selectSource(sourceId)
              }}
            />
          )}

          {playback.fallbackNotice && (
            <p role="status" className="mb-3 text-sm text-zinc-300">{playback.fallbackNotice}</p>
          )}

          {/* Promoted to full-viewport with CSS rather than reparented — moving the
              iframe/video in the DOM would remount it and restart playback. */}
          <div
            ref={playerShellRef}
            data-testid="player-shell"
            className={
              theaterMode
                ? 'fixed inset-0 z-50 flex items-center justify-center bg-black'
                : `relative w-full overflow-hidden rounded-2xl bg-black shadow-2xl ring-1 ring-white/10 ${
                  showsMedia ? 'aspect-video' : 'min-h-56 sm:aspect-video sm:min-h-0'
                }`
            }
          >
            {theaterMode && (
              <button
                ref={exitButtonRef}
                type="button"
                onClick={exitTheater}
                className={`${THEATER_BUTTON} right-4`}
                aria-label="Exit theater mode"
              >
                <Minimize2 size={18} aria-hidden="true" />
              </button>
            )}
            {theaterMode && showsIframe && (
              <button
                type="button"
                onClick={reloadPlayer}
                className={`${THEATER_BUTTON} right-[4.25rem]`}
                aria-label="Reload player"
                title="Stuck loading? Reload player"
              >
                <RotateCw size={18} aria-hidden="true" />
              </button>
            )}
            {!playsNative ? (
              <DynamicPlayerStage
                stage={stage}
                iframeRef={iframeRef}
                title={title}
                itemKind={isTv ? 'episode' : 'movie'}
                sourceLabel={sourceLabel}
                showSourceLabel={playableSources.length > 1}
                fallbackLabel={playback.fallbackSource ? getSourceLabel(playback.fallbackSource) : null}
                withStartTime={(url) => withStartTime(url, progress.resumePosition)}
                onPlay={() => setInlinePlaybackRequested(true)}
                onFrameLoad={playback.revealIframe}
                onRetry={() => {
                  setMediaError(null)
                  playback.retryActiveSource()
                }}
                onFallback={() => {
                  if (playback.fallbackSource) playback.selectSource(playback.fallbackSource.id)
                }}
                onStop={() => {
                  stopPlayback()
                  exitTheater()
                }}
              />
            ) : (
              <NativeVideoPlayer
                videoRef={videoRef}
                src={isDynamic ? playback.extractedUrl! : activeSource.sourceUrl}
                playbackKind={isDynamic ? playback.playbackKind : 'video'}
                title={title}
                playing={videoPlaying}
                resumePosition={progress.resumePosition}
                onPlayingChange={setVideoPlaying}
                onProgress={progress.saveProgress}
                onPlaybackError={(message) => setMediaError(message ? { sourceId: activeSource.id, message } : null)}
                onMediaError={(message) => playback.markSourceFailed(activeSource, 'media-error', message)}
              />
            )}
          </div>

          {currentMediaError && (
            <p role="alert" className="mt-3 flex items-start gap-2 rounded-2xl border border-red-400/20 bg-red-400/8 px-4 py-3 text-sm text-red-200">
              <AlertCircle className="mt-0.5 shrink-0" size={17} aria-hidden="true" />
              {currentMediaError}
            </p>
          )}
        </div>

        {isTv && !theaterMode && (
          <EpisodeSidebar
            seasonCount={numberOfSeasons ?? selection.availableSeasons.length}
            seasons={selection.availableSeasons}
            activeSeason={season}
            listings={listings}
            activeSourceId={activeSource.id}
            loading={selection.loadingEpisodes}
            error={selection.episodesError}
            isWatched={(episodeNumber) => isEpisodeWatched(id, season, episodeNumber)}
            onSelectSeason={selection.selectSeason}
            onSelectEpisode={selection.selectEpisode}
            onToggleWatched={(episodeNumber) => toggleEpisodeWatched(id, season, episodeNumber)}
          />
        )}
      </div>
    </section>
  )
}
