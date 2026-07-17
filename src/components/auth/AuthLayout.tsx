import { type ReactNode, useState } from 'react'
import { BrandMark } from '../layout/BrandMark'

type AuthLayoutProps = {
  eyebrow: string
  title: string
  subtitle: string
  children: ReactNode
  footer?: ReactNode
}

export function AuthLayout({ eyebrow, title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <div className="relative flex min-h-dvh flex-col bg-black font-sans text-[#fafafa] antialiased selection:bg-white/20 selection:text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(255,255,255,0.05),transparent_45rem)]" />

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 py-12">
        <section className="flex w-full max-w-[380px] flex-col">
          <div className="text-center">
            <div className="mb-7 flex justify-center">
              <BrandMark className="text-[24px] text-white" />
            </div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-zinc-500">{eyebrow}</p>
            <h1 className="mt-2 text-[30px] font-semibold leading-tight tracking-tight text-white">{title}</h1>
            <p className="mt-2.5 text-[15px] font-normal leading-relaxed text-zinc-400">{subtitle}</p>
          </div>

          {children}

          {footer && <div className="mt-8 text-center text-[13px]">{footer}</div>}
        </section>
      </main>

      <AuthFooter />
    </div>
  )
}

function AuthFooter() {
  return (
    <footer className="z-10 mx-auto mt-auto flex w-full max-w-5xl flex-col items-center justify-between gap-4 border-t border-zinc-900 px-6 py-6 text-[12px] font-normal text-zinc-500 sm:flex-row">
      <div>Copyright © {new Date().getFullYear()} Fedora Movies Inc. All rights reserved.</div>
      <div className="flex items-center gap-4">
        <a href="#" onClick={(event) => event.preventDefault()} className="transition-colors hover:text-zinc-300">Privacy Policy</a>
        <span className="text-zinc-800">|</span>
        <a href="#" onClick={(event) => event.preventDefault()} className="transition-colors hover:text-zinc-300">Terms of Use</a>
        <span className="text-zinc-800">|</span>
        <a href="#" onClick={(event) => event.preventDefault()} className="transition-colors hover:text-zinc-300">Support</a>
      </div>
    </footer>
  )
}

/** Groups fields into a single hairline-divided card, the way Apple stacks sign-in inputs. */
export function AuthFieldGroup({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-[#161617]/50 transition-all duration-200 focus-within:border-white focus-within:ring-4 focus-within:ring-white/10 [&>*+*]:border-t [&>*+*]:border-zinc-800/80">
      {children}
    </div>
  )
}

type AuthFieldProps = {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'password'
  autoComplete?: string
  autoFocus?: boolean
  minLength?: number
  maxLength?: number
  describedBy?: string
}

export function AuthField({
  id,
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
  autoFocus,
  minLength,
  maxLength,
  describedBy,
}: AuthFieldProps) {
  const [focused, setFocused] = useState(false)
  const raised = focused || value.length > 0

  return (
    <div className="relative h-[56px] focus-within:z-10">
      <input
        id={id}
        required
        type={type}
        value={value}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        minLength={minLength}
        maxLength={maxLength}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="h-full w-full bg-transparent px-[16px] pb-[4px] pt-[20px] text-[17px] text-[#fafafa] outline-none"
      />
      <label
        htmlFor={id}
        className={`pointer-events-none absolute left-[16px] origin-left transition-all duration-200 ${
          raised ? 'top-[6px] text-[11px] font-medium text-zinc-500' : 'top-[16px] text-[17px] text-zinc-400'
        }`}
      >
        {label}
      </label>
    </div>
  )
}

export function AuthError({ message }: { message: string }) {
  return (
    <div role="alert" className="animate-fadeIn flex items-start gap-2.5 rounded-xl border border-white/10 bg-zinc-900/40 p-3.5 text-[13px] text-zinc-200">
      <svg className="mt-0.5 size-4.5 shrink-0 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
      <span className="leading-snug">{message}</span>
    </div>
  )
}

type AuthSubmitButtonProps = {
  submitting: boolean
  pendingLabel: string
  children: ReactNode
}

export function AuthSubmitButton({ submitting, pendingLabel, children }: AuthSubmitButtonProps) {
  return (
    <div className="pt-2">
      <button
        type="submit"
        disabled={submitting}
        className="flex min-h-[50px] w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-white font-medium text-black transition-all duration-200 hover:bg-[#e8e8ed] active:scale-[0.98] disabled:cursor-wait disabled:opacity-50 disabled:active:scale-100"
      >
        {submitting ? (
          <>
            <svg className="size-5 animate-spin text-black" viewBox="0 0 24 24" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span>{pendingLabel}</span>
          </>
        ) : (
          <span>{children}</span>
        )}
      </button>
    </div>
  )
}
