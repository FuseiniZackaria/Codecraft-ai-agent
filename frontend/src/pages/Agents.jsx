import { useStore } from '../store/useStore';
import AgentCard from '../components/AgentCard';

export default function Agents() {
  const { agents } = useStore();

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="font-[var(--font-display)] text-xl font-semibold mb-1">Agents</h1>
      <p className="text-sm text-[var(--color-text-muted)] mb-6">
        Specialized workers the orchestrator assigns tasks to.
      </p>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((agent) => (
          <AgentCard key={agent.key} agent={agent} />
        ))}
      </div>
    </div>
  );
}
