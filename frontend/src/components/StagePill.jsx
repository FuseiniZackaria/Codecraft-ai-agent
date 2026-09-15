const STYLES = {
  verified: 'text-[var(--color-success)] bg-[var(--color-success)]/10 border-[var(--color-success)]/30',
  contact_found: 'text-[var(--color-success)] bg-[var(--color-success)]/10 border-[var(--color-success)]/30',
  outreach_drafted: 'text-[var(--color-warning)] bg-[var(--color-warning)]/10 border-[var(--color-warning)]/30',
  awaiting_approval: 'text-[var(--color-warning)] bg-[var(--color-warning)]/10 border-[var(--color-warning)]/30',
  sent: 'text-[var(--color-accent)] bg-[var(--color-accent)]/10 border-[var(--color-accent)]/30',
  response_received: 'text-[var(--color-accent)] bg-[var(--color-accent)]/10 border-[var(--color-accent)]/30',
  call_requested: 'text-[var(--color-accent)] bg-[var(--color-accent)]/10 border-[var(--color-accent)]/30',
  call_scheduled: 'text-[var(--color-success)] bg-[var(--color-success)]/10 border-[var(--color-success)]/30',
  rejected_verification: 'text-[var(--color-danger)] bg-[var(--color-danger)]/10 border-[var(--color-danger)]/30',
  rejected_contact: 'text-[var(--color-danger)] bg-[var(--color-danger)]/10 border-[var(--color-danger)]/30',
  discovered: 'text-[var(--color-text-muted)] bg-[var(--color-surface-2)] border-[var(--color-border)]',
  verification: 'text-[var(--color-text-muted)] bg-[var(--color-surface-2)] border-[var(--color-border)]',
};

const LABELS = {
  discovered: 'Discovered',
  verification: 'Verifying',
  verified: 'Verified',
  contact_found: 'Contact found',
  outreach_drafted: 'Drafted',
  awaiting_approval: 'Awaiting approval',
  sent: 'Sent',
  response_received: 'Responded',
  call_requested: 'Call requested',
  call_scheduled: 'Call scheduled',
  rejected_verification: 'Rejected (verification)',
  rejected_contact: 'Rejected (contact)',
};

export default function StagePill({ stage }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border font-medium whitespace-nowrap ${STYLES[stage] || STYLES.discovered}`}>
      {LABELS[stage] || stage}
    </span>
  );
}