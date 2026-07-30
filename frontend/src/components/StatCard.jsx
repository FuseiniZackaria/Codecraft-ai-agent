export default function StatCard({ label, value, accent = false }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="text-xs text-[var(--color-text-muted)] mb-1.5">{label}</div>
      <div className={`font-[var(--font-display)] text-2xl font-semibold ${accent ? 'text-[var(--color-accent)]' : 'text-[var(--color-text)]'}`}>
        {value}
      </div>
    </div>
  );
}
