import { AlertCircle } from 'lucide-react';

/**
 * Shared bits for forms: every field says whether it's Required or Optional,
 * a skipped required field (or a badly filled optional one) shows a message
 * under it, and a summary above the Save button says what to fix. Save stays
 * clickable - clicking it with something missing explains what's missing.
 */

/** "Required *" or "Optional" next to a field's label. */
export function FieldTag({ required = false }) {
  return required
    ? <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-danger)]">Required<span aria-hidden="true"> *</span></span>
    : <span className="ml-1 text-[10px] font-normal uppercase tracking-wide text-[var(--color-text-muted)]">Optional</span>;
}

/** The message under a field. */
export function FieldError({ id, children }) {
  if (!children) return null;
  return (
    <p id={id} className="mt-1 text-xs font-normal text-[var(--color-danger)] flex items-center gap-1">
      <AlertCircle size={11} className="shrink-0" /> {children}
    </p>
  );
}

/** Red border for a field with a problem (add to the field's own classes). */
export const invalidCls = (bad) => (bad ? '!border-[var(--color-danger)] focus:!border-[var(--color-danger)]' : '');

/** Props that tell screen readers a field is required / has a problem. */
export const a11y = (id, { required = false, error = null } = {}) => ({
  id,
  'aria-required': required ? 'true' : undefined,
  'aria-invalid': error ? 'true' : undefined,
  'aria-describedby': error ? `${id}-error` : undefined,
});

/** The box above Save: which required fields are missing, which optional ones look wrong. */
export function FormSummary({ missing = [], invalid = [] }) {
  if (!missing.length && !invalid.length) return null;
  return (
    <div role="alert" className="flex items-start gap-2 p-3 bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 rounded-md text-sm text-[var(--color-danger)]">
      <AlertCircle size={14} className="mt-0.5 shrink-0" />
      <div>
        {missing.length > 0 && (
          <div>Please fill in the required {missing.length === 1 ? 'field' : 'fields'}: <strong>{missing.join(', ')}</strong>.</div>
        )}
        {invalid.length > 0 && (
          <div>Please check: <strong>{invalid.join(', ')}</strong>.</div>
        )}
      </div>
    </div>
  );
}

/** Focus (and scroll to) the first field with a problem. ids in form order. */
export function focusFirst(ids, errors, root = document) {
  const first = ids.find((id) => errors[id]);
  if (!first) return;
  const el = root.querySelector(`#${CSS.escape(first)}`);
  el?.focus();
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

const URL_RE = /^(https?:\/\/)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(:\d+)?(\/\S*)?$/i;
export const isWebAddress = (v) => URL_RE.test(String(v || '').trim());
export const isEmailAddress = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
