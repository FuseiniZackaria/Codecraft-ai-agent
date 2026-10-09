import { Link, useLocation } from 'react-router-dom';
import { Compass, ArrowLeft } from 'lucide-react';

export default function NotFound() {
  const location = useLocation();
  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center">
        <div className="flex items-center justify-center mb-3">
          <Compass size={28} className="text-[var(--color-accent)]" />
        </div>
        <h1 className="font-[var(--font-display)] text-xl font-semibold mb-1">Page not found</h1>
        <p className="text-sm text-[var(--color-text-muted)] mb-4 break-all">
          Nothing is wired up at <code className="font-[var(--font-mono)]">{location.pathname}</code>.
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-md bg-[var(--color-accent)] text-black hover:brightness-110"
        >
          <ArrowLeft size={14} />
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
