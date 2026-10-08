import { useStore } from '../store/useStore';
import AgentCard from './AgentCard';

export default function DepartmentOverview({ departmentKey }) {
  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);

  const deptAgents = agents.filter((a) => (a.section || 'other') === departmentKey);
  const agentKeys = new Set(deptAgents.map((a) => a.key));

  const pendingCount = tasks.filter((t) => agentKeys.has(t.agent) && t.status === 'pending_approval').length;

  return (
    <div className="space-y-8">
      {pendingCount > 0 && (
        <div className="rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 p-4">
          <div className="text-sm font-medium text-[var(--color-warning)]">
            {pendingCount} action{pendingCount > 1 ? 's' : ''} waiting on you
          </div>
          <div className="text-xs text-[var(--color-text-muted)]">
            Check the Approvals tab to review and approve.
          </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-medium text-[var(--color-text-muted)] mb-3">
          Team ({deptAgents.length})
        </h2>
        {deptAgents.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No agents in this department.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {deptAgents.map((agent) => (
              <AgentCard key={agent.key} agent={agent} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
