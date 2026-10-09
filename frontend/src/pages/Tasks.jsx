import { useEffect, useRef, useState } from 'react';
import { Trash2, CheckCheck } from 'lucide-react';
import { useStore } from '../store/useStore';
import { api } from '../services/api';
import { createResilientEventSource } from '../services/resilientEventSource';
import TaskRow from '../components/TaskRow';

export default function Tasks() {
  const { tasks, refresh, markAllTasksRead } = useStore();
  const [expandedId, setExpandedId] = useState(null);
  const [liveNarration, setLiveNarration] = useState({});
  const [selected, setSelected] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  const [marking, setMarking] = useState(false);
  const sorted = [...tasks].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const unreadCount = tasks.filter((t) => !t.read).length;

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

  // Clear stale selections when the task list changes
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(tasks.map((t) => t.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [tasks]);

  const allSelected = sorted.length > 0 && selected.size === sorted.length;
  const someSelected = selected.size > 0;

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(sorted.map((t) => t.id)));
  }

  function toggleOne(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deleteSelected() {
    if (!someSelected) return;
    const count = selected.size;
    if (!window.confirm(`Delete ${count} task${count === 1 ? '' : 's'}? This can't be undone.`)) return;
    setDeleting(true);
    try {
      const result = await api.bulkDeleteTasks([...selected]);
      setSelected(new Set());
      if (result.failed) {
        const reason = result.errors?.[0]?.error || 'unknown error';
        alert(`${result.failed} task${result.failed === 1 ? '' : 's'} couldn't be deleted: ${reason}`);
      }
    } catch (err) {
      alert(`Delete failed: ${err.message}`);
    } finally {
      await refresh();
      setDeleting(false);
    }
  }

  async function handleMarkAllRead() {
    setMarking(true);
    try {
      await markAllTasksRead();
    } catch (err) {
      alert(`Failed to mark as read: ${err.message}`);
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h1 className="font-[var(--font-display)] text-xl font-semibold">Tasks</h1>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            disabled={marking}
            className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1 text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-accent)]/5 transition-colors disabled:opacity-50"
          >
            <CheckCheck size={13} />
            {marking ? 'Marking…' : `Mark all as read (${unreadCount})`}
          </button>
        )}
      </div>
      <p className="text-sm text-[var(--color-text-muted)] mb-4">
        Everything the orchestrator has queued, run, or paused for your approval. Click a completed task to see its full result.
      </p>

      {sorted.length > 0 && (
        <div className="flex items-center gap-3 mb-3">
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allSelected}
              ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
              onChange={toggleAll}
              className="accent-[var(--color-accent)]"
            />
            {allSelected ? 'Deselect all' : 'Select all'}
          </label>
          {someSelected && (
            <button
              onClick={deleteSelected}
              disabled={deleting}
              className="flex items-center gap-1.5 rounded-md border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 px-2.5 py-1 text-xs font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15 transition-colors disabled:opacity-50"
            >
              <Trash2 size={13} />
              {deleting ? 'Deleting…' : `Delete ${selected.size} selected`}
            </button>
          )}
        </div>
      )}

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
              selectable
              isSelected={selected.has(task.id)}
              onSelect={() => toggleOne(task.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
