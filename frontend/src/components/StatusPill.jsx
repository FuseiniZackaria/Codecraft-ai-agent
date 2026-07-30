const STYLES = {
  done: 'text-[var(--color-success)] bg-[var(--color-success)]/10 border-[var(--color-success)]/30',
  failed: 'text-[var(--color-danger)] bg-[var(--color-danger)]/10 border-[var(--color-danger)]/30',
  pending_approval: 'text-[var(--color-warning)] bg-[var(--color-warning)]/10 border-[var(--color-warning)]/30',
  pending: 'text-[var(--color-text-muted)] bg-[var(--color-surface-2)] border-[var(--color-border)]',
  rejected: 'text-[var(--color-text-muted)] bg-[var(--color-surface-2)] border-[var(--color-border)]',
};

const LABELS = {
  done: 'Done',
  failed: 'Failed',
  pending_approval: 'Needs approval',
  pending: 'Pending',
  rejected: 'Rejected',
};

export default function StatusPill({ status }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border font-medium ${STYLES[status] || STYLES.pending}`}>
      {LABELS[status] || status}
    </span>
  );
}
