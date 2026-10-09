import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export default function PasswordInput({
  value,
  onChange,
  placeholder,
  autoFocus,
  autoComplete,
  className = '',
  visible: controlledVisible,
  onVisibleChange,
}) {
  const [internalVisible, setInternalVisible] = useState(false);
  const isControlled = controlledVisible !== undefined;
  const visible = isControlled ? controlledVisible : internalVisible;

  function toggle() {
    const next = !visible;
    if (!isControlled) setInternalVisible(next);
    onVisibleChange?.(next);
  }

  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        className={`w-full pr-10 px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-base md:text-sm outline-none focus:border-[var(--color-accent)]/50 ${className}`}
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={visible ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-0 flex items-center justify-center w-10 min-h-[40px] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
