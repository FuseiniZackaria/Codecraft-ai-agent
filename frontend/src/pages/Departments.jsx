import { Link } from 'react-router-dom';
import { useStore } from '../store/useStore';
import DEPARTMENTS from '../data/departmentConfig';

export default function Departments() {
  const agents = useStore((s) => s.agents);

  const agentCounts = {};
  for (const a of agents) {
    const key = a.section || 'other';
    agentCounts[key] = (agentCounts[key] || 0) + 1;
  }

  const visible = DEPARTMENTS.filter((d) => d.key === 'other' ? agentCounts[d.key] > 0 : true);

  return (
    <div className="p-4 sm:p-6 max-w-5xl">
      <h1 className="font-[var(--font-display)] text-xl font-semibold mb-1">Departments</h1>
      <p className="text-sm text-[var(--color-text-muted)] mb-6">
        Your business, organised by function. Each department has its own agents, tools, and workflows.
      </p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visible.map((dept) => {
          const Icon = dept.icon;
          const count = agentCounts[dept.key] || 0;
          return (
            <Link
              key={dept.key}
              to={`/departments/${dept.key}`}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5 hover:border-[var(--color-accent)]/40 transition-colors group flex flex-col gap-3"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-md bg-[var(--color-accent-dim)] flex items-center justify-center shrink-0">
                  <Icon size={20} className="text-[var(--color-accent)]" />
                </div>
                <div className="min-w-0">
                  <div className="font-[var(--font-display)] font-semibold text-sm group-hover:text-[var(--color-accent)] transition-colors">
                    {dept.label}
                  </div>
                  <div className="text-[11px] text-[var(--color-text-muted)] font-[var(--font-mono)]">
                    {count} agent{count !== 1 ? 's' : ''}
                  </div>
                </div>
              </div>
              <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">
                {dept.description}
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
