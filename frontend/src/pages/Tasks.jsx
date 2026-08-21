import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { api } from '../services/api';
import TaskRow from '../components/TaskRow';

export default function Tasks() {
  const { tasks } = useStore();
  const [expandedId, setExpandedId] = useState(null);
  const [liveNarration, setLiveNarration] = useState({}); // taskId -> latest narration text
  const sorted = [...tasks].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // One shared SSE connection for the whole page, same pattern already
  // proven on the Console page - not one connection per row.
  useEffect(() => {
    const es = new EventSource(api.eventsStreamUrl());
    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data);
        if (event.action === 'narration' && event.taskId) {
          setLiveNarration((prev) => ({ ...prev, [event.taskId]: event.metadata?.text || '' }));
        }
      } catch {
        // ignore malformed/comment lines, same as Console.jsx
      }
    };
    return () => es.close();
  }, []);

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
              liveNarration={task.status === 'pending' ? liveNarration[task.id] : null}
            />
          ))
        )}
      </div>
    </div>
  );
}
