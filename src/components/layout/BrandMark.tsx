type BrandMarkProps = {
  className?: string
}

/** The "Fedora Movies" wordmark. Sizes off the inherited font size, so callers set it with a text-* class. */
export function BrandMark({ className = '' }: BrandMarkProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 tracking-tight ${className}`}>
      {/* Fedora Hat SVG Icon */}
      <svg className="size-[1.65em] shrink-0 text-indigo-400" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="32" cy="32" r="20" fill="url(#brand-glow)" opacity="0.25" />
        <path d="M22 36C21.5 28.5 24 20 32 20C40 20 42.5 28.5 42 36H22Z" fill="url(#brand-hat)" />
        <path d="M26 21C29 23.5 35 23.5 38 21C39 22 40 23.5 40 24.5C37 22.5 27 22.5 24 24.5C24 23.5 25 22 26 21Z" fill="#1E1B4B" opacity="0.4" />
        <path d="M10 39C20 35 44 35 54 39C56 39.8 54 41.5 50 41.5C40 40 24 40 14 41.5C10 41.5 8 39.8 10 39Z" fill="url(#brand-hat)" />
        <path d="M21.8 33.5C25 34 39 34 42.2 33.5C42.8 34.5 43.1 35.5 43.1 36H20.9C20.9 35.5 21.2 34.5 21.8 33.5Z" fill="#6366F1" />
        <defs>
          <linearGradient id="brand-glow" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse">
            <stop stopColor="#6366F1" />
            <stop offset="1" stopColor="#10B981" />
          </linearGradient>
          <linearGradient id="brand-hat" x1="10" y1="20" x2="54" y2="41.5" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFFFFF" />
            <stop offset="1" stopColor="#E4E4E7" />
          </linearGradient>
        </defs>
      </svg>
      <span className="text-[1.25em] font-black tracking-tight text-white leading-none">
        Fedora<span className="font-semibold text-zinc-400">Movies</span>
      </span>
    </span>
  )
}
