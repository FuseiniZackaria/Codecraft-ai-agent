import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Radio, Play, Brain, Wrench, CheckCircle2, XCircle, AlertTriangle,
  ThumbsUp, ThumbsDown, ListTree, Puzzle, Clock, Trash2, Pause,
} from 'lucide-react';
import { api } from '../services/api';

const ACTION_META = {
  task_queued: { icon: Clock, color: 'text-[var(--color-text-muted)]', label: 'queued' },
  task_started: { icon: Play, color: 'text-[var(--color-accent)]', label: 'started' },
  plan_created: { icon: ListTree, color: 'text-[var(--color-accent)]', label: 'planned' },
  step_started: { icon: Brain, color: 'text-[var(--color-warning)]', label: 'thinking', pulse: true },
  llm_call: { icon: Brain, color: 'text-[var(--color-accent)]', label: 'reasoned' },
  tool_call: { icon: Wrench, color: 'text-[var(--color-accent)]', label: 'used tool' },
  task_completed: { icon: CheckCircle2, color: 'text-[var(--color-success)]', label: 'completed' },
  task_failed: { icon: XCircle, color: 'text-[var(--color-danger)]', label: 'failed' },
  task_execution_failed: { icon: XCircle, color: 'text-[var(--color-danger)]', label: 'execution failed' },
  approval_required: { icon: AlertTriangle, color: 'text-[var(--color-warning)]', label: 'needs approval' },
  task_approved: { icon: ThumbsUp, color: 'text-[var(--color-success)]', label: 'approved' },
  task_rejected: { icon: ThumbsDown, color: 'text-[var(--color-danger)]', label: 'rejected' },
  plugin_loaded: { icon: Puzzle, color: 'text-[var(--color-text-muted)]', label: 'plugin loaded' },
};

function metaFor(action) {
  return ACTION_META[action] || { icon: Radio, color: 'text-[var(--color-text-muted)]', label: action };
}

function EventLine({ event }) {
  const { icon: Icon, color, pulse } = metaFor(event.action);
  const detail = [];
  if (event.metadata?.stepCount != null) detail.push(`${event.metadata.stepCount} step(s)`);
  if (event.metadata?.cost != null) detail.push(`$${event.metadata.cost}`);
  if (event.metadata?.error) detail.push(event.metadata.error);
  if (event.metadata?.args) detail.push(JSON.stringify(event.metadata.args).slice(0, 60));

  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <Icon size={13} className={`${color} shrink-0 mt-0.5 ${pulse ? 'pulse-live rounded-full' : ''}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          <span className="text-[var(--color-text)] font-medium">{event.actor}</span>
          <span className="text-[var(--color-text-muted)]">{metaFor(event.action).label}</span>
          {event.target && (
            <span className="font-[var(--font-mono)] text-[var(--color-accent)]">{event.target}</span>
          )}
        </div>
        {detail.length > 0 && (
          <div className="text-[11px] text-[var(--color-text-muted)] font-[var(--font-mono)] truncate">
            {detail.join(' · ')}
          </div>
        )}
      </div>
      <span className="text-[10px] text-[var(--color-text-muted)] font-[var(--font-mono)] shrink-0">
        {new Date(event.at).toLocaleTimeString()}
      </span>
    </div>
  );
}

function TraceCard({ taskId, events }) {
  const first = events[0];
  const last = events[events.length - 1];
  const isRunning = !['task_completed', 'task_failed', 'task_execution_failed', 'task_rejected'].includes(last.action);
  const failed = ['task_failed', 'task_execution_failed'].includes(last.action);
  const durationMs = new Date(last.at) - new Date(first.at);

  const statusColor = isRunning
    ? 'border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5'
    : failed
    ? 'border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5'
    : 'border-[var(--color-border)] bg-[var(--color-surface)]';

  return (
    <div className={`rounded-lg border p-3.5 ${statusColor}`}>
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="min-w-0 flex items-center gap-2">
          {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-warning)] pulse-live shrink-0" />}
          <span className="text-sm font-medium truncate">
            {first.metadata?.instruction || first.target || taskId.slice(0, 8)}
          </span>
        </div>
        <span className="text-[10px] font-[var(--font-mono)] text-[var(--color-text-muted)] shrink-0">
          {isRunning ? 'running…' : `${durationMs}ms`}
        </span>
      </div>
      <div className="pl-1 border-l border-[var(--color-border)] ml-1.5 divide-y divide-[var(--color-border)]/50">
        <div className="pl-3 -space-y-0">
          {events.map((e) => (
            <EventLine key={e.id} event={e} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Console() {
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState('connecting');
  const [live, setLive] = useState(true);
  const seenIds = useRef(new Set());
  const esRef = useRef(null);
  const liveRef = useRef(true);

  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  function addEvents(newEvents) {
    const fresh = newEvents.filter((e) => !seenIds.current.has(e.id));
    fresh.forEach((e) => seenIds.current.add(e.id));
    if (!fresh.length) return;
    setEvents((prev) => [...prev, ...fresh].slice(-500));
  }

  useEffect(() => {
    let cancelled = false;

    api.getRecentEvents(200).then((recent) => {
      if (!cancelled) addEvents(recent);
    }).catch(() => {});

    const es = new EventSource(api.eventsStreamUrl());
    esRef.current = es;
    es.onopen = () => setStatus('live');
    es.onerror = () => setStatus('error');
    es.onmessage = (msg) => {
      if (!liveRef.current) return; // paused - drop new events until resumed
      try {
        addEvents([JSON.parse(msg.data)]);
      } catch {
        // ignore malformed/comment lines
      }
    };

    return () => {
      cancelled = true;
      es.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const traces = useMemo(() => {
    const grouped = new Map();
    const systemEvents = [];
    for (const e of events) {
      if (!e.taskId) {
        systemEvents.push(e);
        continue;
      }
      if (!grouped.has(e.taskId)) grouped.set(e.taskId, []);
      grouped.get(e.taskId).push(e);
    }
    const groups = Array.from(grouped.entries()).map(([taskId, evs]) => ({
      taskId,
      events: evs,
      lastAt: evs[evs.length - 1].at,
    }));
    groups.sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
    return { groups, systemEvents };
  }, [events]);

  return (
    <div className="p-6 max-w-4xl flex flex-col h-full">
      <div className="flex items-center justify-between mb-1">
        <h1 className="font-[var(--font-display)] text-xl font-semibold">Agent Console</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLive((v) => !v)}
            className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            title={live ? 'Pause live updates' : 'Resume live updates'}
          >
            {live ? <Pause size={12} /> : <Radio size={12} />}
            {live ? 'Live' : 'Paused'}
          </button>
          <button
            onClick={() => { setEvents([]); seenIds.current.clear(); }}
            className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-danger)]"
            title="Clear"
          >
            <Trash2 size={12} /> Clear
          </button>
        </div>
      </div>
      <p className="text-sm text-[var(--color-text-muted)] mb-4">
        Watch agents plan, call tools, and complete tasks in real time — high-level actions only, never raw reasoning.
      </p>

      <div className="flex items-center gap-1.5 mb-4 text-xs">
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            status === 'live' ? 'bg-[var(--color-success)] pulse-live' : status === 'error' ? 'bg-[var(--color-danger)]' : 'bg-[var(--color-warning)]'
          }`}
        />
        <span className="text-[var(--color-text-muted)]">
          {status === 'live' ? 'Connected' : status === 'error' ? 'Disconnected — retrying…' : 'Connecting…'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pb-6">
        {traces.groups.length === 0 && traces.systemEvents.length === 0 && (
          <div className="text-sm text-[var(--color-text-muted)] py-12 text-center border border-dashed border-[var(--color-border)] rounded-lg">
            No activity yet — submit a goal from Chat and watch it appear here live.
          </div>
        )}

        {traces.groups.map((g) => (
          <TraceCard key={g.taskId} taskId={g.taskId} events={g.events} />
        ))}

        {traces.systemEvents.length > 0 && (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5">
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] font-[var(--font-mono)] mb-1">
              System
            </div>
            {traces.systemEvents.slice(-10).map((e) => (
              <EventLine key={e.id} event={e} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
