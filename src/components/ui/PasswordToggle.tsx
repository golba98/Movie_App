import { Eye, EyeOff } from 'lucide-react'

interface PasswordToggleProps {
  visible: boolean
  label: string
  controls: string
  iconSize: number
  className: string
  onToggle: () => void
}

/** Show/hide button that sits inside a password field without stealing its focus. */
export function PasswordToggle({ visible, label, controls, iconSize, className, onToggle }: PasswordToggleProps) {
  const Icon = visible ? EyeOff : Eye
  return (
    <button
      type="button"
      onClick={onToggle}
      onMouseDown={(event) => event.preventDefault()}
      aria-label={`${visible ? 'Hide' : 'Show'} ${label}`}
      aria-controls={controls}
      aria-pressed={visible}
      className={`absolute right-2 top-1/2 grid -translate-y-1/2 place-items-center rounded-full text-zinc-500 transition hover:bg-white/8 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${className}`}
    >
      <Icon size={iconSize} aria-hidden="true" />
    </button>
  )
}
