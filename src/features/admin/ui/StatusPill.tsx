export function StatusPill({ active, activeLabel, inactiveLabel, inactiveClassName }: {
  active: boolean
  activeLabel: string
  inactiveLabel: string
  inactiveClassName: string
}) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${active ? 'bg-emerald-400/12 text-emerald-300' : inactiveClassName}`}>
      {active ? activeLabel : inactiveLabel}
    </span>
  )
}
