import { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { api } from '../services/api';
import { createResilientEventSource } from '../services/resilientEventSource';
import TaskRow from './TaskRow';

export default function DepartmentTasks({ departmentKey }) {
  const { agents, tasks } = useStore();
  const [expandedId, setExpandedId] = useState(null);
  const [liveNarration, setLiveNarration] = useState({});

  const agentKeys = new Set(
    agents
      .filter((a) => (a.section || 'other') === departmentKey)
      .map((a) => a.key)
  );

  const filtered = tasks
    .filter((t) => agentKeys.has(t.agent))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  useEffect(() => {
    const conn = createResilientEventSource(
      api.getEventsStreamUrl,
      (msg) => {
        try {
          const event = JSON.parse(msg.data);
          if (event.action === 'narration' && event.taskId) {
            setLiveNarration((prev) => ({ ...prev, [event.taskId]: event.metadata?.text || '' }));
          }
        } catch {}
      },
    );
    return () => conn.close();
  }, []);

  return (
    <div>
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">
            No tasks yet for this department.
          </div>
        ) : (
          filtered.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              expanded={expandedId === task.id}
              onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
              liveNarration={task.status === 'pending' ? liveNarration[task.id] : null}
            />
          ))
        )}
      </div>
    </div>
  );
}
