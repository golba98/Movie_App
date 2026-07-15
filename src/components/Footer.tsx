export function Footer() {
  return (
    <footer className="border-t border-[#262626]">
      <div className="mx-auto flex max-w-7xl flex-col gap-1 px-6 py-8 lg:px-8">
        <p className="text-sm text-[#999999]">A legal movie discovery demo using TMDB data.</p>
        <p className="text-xs text-[#666666]">
          This product uses the{' '}
          <a
            href="https://www.themoviedb.org"
            target="_blank"
            rel="noreferrer"
            className="rounded underline-offset-2 transition-colors hover:text-[#999999] hover:underline"
          >
            TMDB
          </a>{' '}
          API but is not endorsed or certified by TMDB.
        </p>
      </div>
    </footer>
  )
}
