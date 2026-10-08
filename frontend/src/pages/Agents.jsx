import { useState } from 'react';
import {
  TrendingUp, Megaphone, Headphones, Compass, Code2, MoreHorizontal,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import AgentCard from '../components/AgentCard';

const ICON_MAP = { TrendingUp, Megaphone, Headphones, Compass, Code2, MoreHorizontal };

export default function Agents() {
  const { agents, agentSections } = useStore();

  // All sections open by default; keyed by section key.
  const [collapsed, setCollapsed] = useState({});
  function toggle(key) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  // Group agents by section. Agents with an unknown section fall into 'other'.
  const grouped = {};
  for (const agent of agents) {
    const key = agent.section || 'other';
    (grouped[key] = grouped[key] || []).push(agent);
  }

  // Render in the canonical order from agentSections; skip empty sections.
  const visibleSections = agentSections.filter((s) => grouped[s.key]?.length > 0);

  return (
    <div className="p-4 sm:p-6 max-w-5xl">
      <h1 className="font-[var(--font-display)] text-xl font-semibold mb-1">Agents</h1>
      <p className="text-sm text-[var(--color-text-muted)] mb-6">
        Specialised workers organised by department. Click a section heading to collapse it.
      </p>

      <div className="space-y-6">
        {visibleSections.map((section) => {
          const SectionIcon = ICON_MAP[section.icon] || MoreHorizontal;
          const isCollapsed = collapsed[section.key];
          const sectionAgents = grouped[section.key];

          return (
            <div key={section.key}>
              {/* Section heading */}
              <button
                onClick={() => toggle(section.key)}
                className="w-full flex items-center gap-2 mb-3 group text-left"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <SectionIcon
                    size={15}
                    className="text-[var(--color-accent)] shrink-0"
                  />
                  <span className="font-[var(--font-display)] font-semibold text-sm text-[var(--color-text)]">
                    {section.label}
                  </span>
                  <span className="text-[11px] text-[var(--color-text-muted)] font-[var(--font-mono)]">
                    ({sectionAgents.length})
                  </span>
                </div>
                {isCollapsed
                  ? <ChevronRight size={14} className="text-[var(--color-text-muted)] shrink-0" />
                  : <ChevronDown  size={14} className="text-[var(--color-text-muted)] shrink-0" />}
              </button>

              {/* Divider */}
              <div className="h-px bg-[var(--color-border)] mb-3" />

              {/* Agent cards */}
              {!isCollapsed && (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {sectionAgents.map((agent) => (
                    <AgentCard key={agent.key} agent={agent} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
