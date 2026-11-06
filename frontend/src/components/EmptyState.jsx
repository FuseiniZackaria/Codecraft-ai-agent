import { Link } from 'react-router-dom';

/**
 * What an empty page shows instead of a blank space: an icon, one friendly
 * line, a short tip and (optionally) a button to get started.
 * action: { label, to } for a link, or { label, onClick } for a button.
 */
export default function EmptyState({ icon: Icon, title, text, action, compact = false }) {
  const btn = 'inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-black hover:brightness-110';
  return (
    <div className={`flex flex-col items-center text-center ${compact ? 'py-6 px-4' : 'py-10 px-6'}`}>
      {Icon && (
        <div className="w-11 h-11 rounded-full bg-[var(--color-accent)]/10 flex items-center justify-center mb-3">
          <Icon size={20} className="text-[var(--color-accent)]" />
        </div>
      )}
      <div className="text-sm font-semibold text-[var(--color-text)]">{title}</div>
      {text && <p className="text-xs text-[var(--color-text-muted)] mt-1 max-w-sm">{text}</p>}
      {action && (
        <div className="mt-4">
          {action.to
            ? <Link to={action.to} className={btn}>{action.label}</Link>
            : <button type="button" onClick={action.onClick} className={btn}>{action.label}</button>}
        </div>
      )}
    </div>
  );
}
