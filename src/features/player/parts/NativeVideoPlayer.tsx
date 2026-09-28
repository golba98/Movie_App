import { Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { useState, type RefObject } from 'react'
import { formatClock } from '../../../lib/format'
import { MAX_RESUME_SHARE, type ProgressSaveMode } from '../hooks/useWatchProgress'

interface NativeVideoPlayerProps {
  videoRef: RefObject<HTMLVideoElement | null>
  src: string
  title: string
  playing: boolean
  resumePosition: number | null
  onPlayingChange: (playing: boolean) => void
  onProgress: (position: number, duration: number, mode?: ProgressSaveMode) => void
  // null clears a previous error.
  onPlaybackError: (message: string | null) => void
  onMediaError: (message: string | undefined) => void
}

/**
 * A persistent native <video> with app-owned controls. The element stays
 * mounted across control and theater-mode changes so playback never restarts.
 */
export function NativeVideoPlayer({
  videoRef,
  src,
  title,
  playing,
  resumePosition,
  onPlayingChange,
  onProgress,
  onPlaybackError,
  onMediaError,
}: NativeVideoPlayerProps) {
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0

  const togglePlayback = () => {
    const video = videoRef.current
    if (!video) return
    if (!video.paused) {
      video.pause()
      return
    }
    void video.play().catch(() => {
      onPlaybackError('The video could not start. Check the source format and host response.')
    })
  }

  const seek = (time: number) => {
    const video = videoRef.current
    if (!video || !Number.isFinite(time)) return
    video.currentTime = time
    setCurrentTime(time)
  }

  const toggleMuted = () => {
    const video = videoRef.current
    if (!video) return
    video.muted = !muted
    setMuted(!muted)
  }

  const changeVolume = (nextVolume: number) => {
    const video = videoRef.current
    if (!video) return
    video.volume = nextVolume
    video.muted = nextVolume === 0
    setVolume(nextVolume)
    setMuted(nextVolume === 0)
  }

  return (
    <>
      <video
        ref={videoRef}
        src={src}
        playsInline
        preload="metadata"
        className="block size-full bg-black object-contain"
        aria-label={`Video player for ${title}`}
        onDoubleClick={(event) => event.preventDefault()}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget
          onPlaybackError(null)
          setDuration(video.duration)
          setCurrentTime(video.currentTime)
          setVolume(video.volume)
          setMuted(video.muted)
          if (resumePosition !== null && resumePosition < video.duration * MAX_RESUME_SHARE) {
            video.currentTime = resumePosition
            setCurrentTime(resumePosition)
          }
        }}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => {
          const video = event.currentTarget
          setCurrentTime(video.currentTime)
          if (!video.paused) onProgress(video.currentTime, video.duration)
        }}
        onPlay={() => onPlayingChange(true)}
        onPause={(event) => {
          onPlayingChange(false)
          const video = event.currentTarget
          if (!video.ended) onProgress(video.currentTime, video.duration, 'urgent')
        }}
        onSeeked={(event) => {
          const video = event.currentTarget
          if (video.currentTime > 0) onProgress(video.currentTime, video.duration, 'now')
        }}
        onEnded={(event) => {
          const video = event.currentTarget
          onProgress(video.duration, video.duration, 'urgent')
        }}
        onVolumeChange={(event) => {
          setMuted(event.currentTarget.muted)
          setVolume(event.currentTarget.volume)
        }}
        onError={(event) => onMediaError(event.currentTarget.error?.message || undefined)}
      />
      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/95 via-black/70 to-transparent px-3 pb-3 pt-12 sm:px-4 sm:pb-4">
        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-200">
          <button
            type="button"
            onClick={togglePlayback}
            className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-black transition hover:bg-zinc-200 pointer-coarse:size-11"
            aria-label={playing ? 'Pause video' : 'Play video'}
          >
            {playing ? <Pause size={17} fill="currentColor" aria-hidden="true" /> : <Play size={17} fill="currentColor" aria-hidden="true" />}
          </button>
          <span className="shrink-0 tabular-nums" aria-live="off">{formatClock(currentTime)} / {formatClock(safeDuration)}</span>
          <input
            type="range"
            min="0"
            max={safeDuration || 0}
            step="0.1"
            value={Math.min(currentTime, safeDuration || 0)}
            onChange={(event) => seek(Number(event.target.value))}
            disabled={safeDuration === 0}
            className="order-first basis-full accent-white disabled:opacity-40 sm:order-none sm:min-w-20 sm:flex-1 sm:basis-auto"
            aria-label="Seek video"
          />
          <button
            type="button"
            onClick={toggleMuted}
            className="ml-auto grid size-10 shrink-0 place-items-center rounded-full text-zinc-100 transition hover:bg-white/10 pointer-coarse:size-11 sm:ml-0"
            aria-label={muted ? 'Unmute video' : 'Mute video'}
          >
            {muted ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={muted ? 0 : volume}
            onChange={(event) => changeVolume(Number(event.target.value))}
            className="w-20 accent-white pointer-coarse:hidden sm:w-24"
            aria-label="Video volume"
          />
        </div>
      </div>
    </>
  )
}
