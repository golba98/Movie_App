import { ExternalLink } from 'lucide-react'
import type { WatchProviderRegion } from '../../types/tmdb'
import { providerLogoUrl } from '../../utils/images'
import { dedupeProviders } from '../../utils/media'

function providerGroups(providers?: WatchProviderRegion) {
  if (!providers) return []
  return [
    {
      label: 'Stream, free or with ads',
      items: dedupeProviders([...(providers.flatrate ?? []), ...(providers.free ?? []), ...(providers.ads ?? [])]),
    },
    { label: 'Rent', items: dedupeProviders(providers.rent) },
    { label: 'Buy', items: dedupeProviders(providers.buy) },
  ].filter((group) => group.items.length > 0)
}

export function hasWatchProviders(providers?: WatchProviderRegion) {
  return providerGroups(providers).length > 0
}

export function WatchProviders({ providers }: { providers?: WatchProviderRegion }) {
  if (!providers) return null
  const groups = providerGroups(providers)

  if (groups.length === 0) {
    return null
  }

  return (
    <div className="rounded-2xl border border-white/8 bg-white/4 p-5 sm:p-6">
      <div className="space-y-5">
        {groups.map((group) => (
          <div key={group.label}>
            <h3 className="text-sm font-black text-zinc-200">{group.label}</h3>
            <div className="mt-3 flex flex-wrap gap-3">
              {group.items.map((provider) => {
                const logo = providerLogoUrl(provider.logo_path)
                return (
                  <div key={provider.provider_id} className="flex items-center gap-2 rounded-xl bg-black/30 p-2 pr-3">
                    {logo ? (
                      <img src={logo} alt="" className="size-9 rounded-lg object-cover" loading="lazy" />
                    ) : (
                      <span className="grid size-9 place-items-center rounded-lg bg-zinc-800 text-xs font-black text-zinc-400">
                        {provider.provider_name.slice(0, 1)}
                      </span>
                    )}
                    <span className="text-sm font-semibold text-zinc-200">{provider.provider_name}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6 border-t border-white/8 pt-4 text-sm text-zinc-400">
        <p>Availability for South Africa supplied by JustWatch. Check the provider for current terms.</p>
        {providers.link && (
          <a
            href={providers.link}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-white/8 px-4 font-bold text-white transition hover:bg-white/12"
          >
            View legal options on TMDB
            <ExternalLink size={16} aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  )
}
