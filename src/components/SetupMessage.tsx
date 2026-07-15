import { useCopyToClipboard } from '../hooks/useCopyToClipboard'

const commands = [
  { step: 1, label: 'Create your env file', command: 'cp .env.example .env.local' },
  { step: 2, label: 'Add your token', command: 'VITE_TMDB_ACCESS_TOKEN=your_token' },
  { step: 3, label: 'Start the dev server', command: 'npm run dev' },
]

function CommandRow({
  step,
  label,
  command,
}: {
  step: number
  label: string
  command: string
}) {
  const { copied, copy } = useCopyToClipboard()

  return (
    <div className="flex items-center gap-4 border-t border-[#262626] py-4 first:border-t-0">
      <span className="w-4 shrink-0 text-sm tabular-nums text-[#666666]">{step}</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-[#999999]">{label}</p>
        <code className="mt-1 block truncate font-mono text-sm text-[#f5f5f5]">{command}</code>
      </div>
      <button
        type="button"
        onClick={() => copy(command)}
        aria-label={`Copy command: ${command}`}
        className="shrink-0 rounded border border-[#262626] px-2.5 py-1 text-xs text-[#999999] transition-colors hover:border-[#3a3a3a] hover:text-[#f5f5f5]"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

export function SetupMessage() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
      <div className="grid gap-12 md:grid-cols-2 md:gap-16">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-[#999999]">
            Setup required
          </p>
          <h1 className="mt-4 text-2xl font-semibold leading-snug text-[#f5f5f5] sm:text-3xl">
            Connect CineScope to TMDB
          </h1>
          <p className="mt-4 max-w-md text-sm leading-7 text-[#999999]">
            CineScope reads movie and TV data from The Movie Database. To load it, add a TMDB
            API Read Access Token to a local environment file and restart the development server.
          </p>
          <a
            href="https://www.themoviedb.org/settings/api"
            target="_blank"
            rel="noreferrer"
            className="mt-6 inline-flex items-center rounded-md bg-[#f5f5f5] px-4 py-2.5 text-sm font-medium text-[#0a0a0a] transition-colors hover:bg-white"
          >
            Open TMDB settings
          </a>
        </div>

        <div>
          <h2 className="text-sm font-medium text-[#f5f5f5]">Setup</h2>
          <div className="mt-4">
            {commands.map((item) => (
              <CommandRow
                key={item.step}
                step={item.step}
                label={item.label}
                command={item.command}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
