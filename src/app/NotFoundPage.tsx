import { Compass } from 'lucide-react'
import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-[58vh] max-w-xl items-center px-4 py-14 text-center sm:px-6">
      <div className="w-full">
        <Compass className="mx-auto text-brand-400" size={48} aria-hidden="true" />
        <p className="mt-5 text-sm font-black uppercase tracking-[0.18em] text-brand-400">404</p>
        <h1 className="mt-2 text-3xl font-black sm:text-5xl">This page wandered off</h1>
        <p className="mt-4 leading-7 text-zinc-400">The route does not exist, but there are plenty of stories waiting back home.</p>
        <Link to="/" className="mt-7 inline-flex min-h-12 items-center rounded-xl bg-white px-5 font-black text-zinc-950 transition hover:bg-zinc-200">Return home</Link>
      </div>
    </div>
  )
}
