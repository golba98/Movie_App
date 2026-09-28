import { useState } from 'react'
import { PasswordToggle } from '../../../components/ui/PasswordToggle'

interface PasswordInputProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoFocus?: boolean
}

/** A temporary-password field for viewer accounts (12–128 characters). */
export function PasswordInput({ id, label, value, onChange, autoFocus }: PasswordInputProps) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="text-sm text-zinc-300">
      <label htmlFor={id}>{label}</label>
      <span className="relative mt-2 block">
        <input
          id={id}
          required
          type={visible ? 'text' : 'password'}
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
          autoFocus={autoFocus}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="form-input form-input-with-action"
        />
        <PasswordToggle
          visible={visible}
          label={label}
          controls={id}
          iconSize={17}
          className="size-9"
          onToggle={() => setVisible((current) => !current)}
        />
      </span>
    </div>
  )
}
