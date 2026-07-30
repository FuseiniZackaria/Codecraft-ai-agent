import { useState } from 'react';
import { useStore } from '../store/useStore';
import TaskRow from '../components/TaskRow';

export default function Tasks() {
  const { tasks } = useStore();
  const [expandedId, setExpandedId] = useState(null);
  const sorted = [...tasks].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="font-[var(--font-display)] text-xl font-semibold mb-1">Tasks</h1>
      <p className="text-sm text-[var(--color-text-muted)] mb-6">
        Everything the orchestrator has queued, run, or paused for your approval. Click a completed task to see its full result.
      </p>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        {sorted.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">
            No tasks yet — submit a goal from the Chat page or command palette.
          </div>
        ) : (
          sorted.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              expanded={expandedId === task.id}
              onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
