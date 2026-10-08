import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Play, Copy, RotateCcw, Sparkles, AlertTriangle } from 'lucide-react';
import { useStore } from '../store/useStore';
import { api } from '../services/api';
import { createResilientEventSource } from '../services/resilientEventSource';
import { getDepartment } from '../data/departmentConfig';
import TaskRow from './TaskRow';

export default function DepartmentWorkspace({ departmentKey }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const dept = getDepartment(departmentKey);

  const [input, setInput] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [activeTool, setActiveTool] = useState(null);
  const [assistantReply, setAssistantReply] = useState('');
  const [extraFields, setExtraFields] = useState({});
  const [expandedId, setExpandedId] = useState(null);
  const [historyLimit, setHistoryLimit] = useState(20);
  const [liveNarration, setLiveNarration] = useState({});
  const [mismatch, setMismatch] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(null);

  const agents = useStore((s) => s.agents);
  const tasks = useStore((s) => s.tasks);
  const connected = useStore((s) => s.connected);
  const refresh = useStore((s) => s.refresh);

  const deptAgents = agents.filter((a) => (a.section || 'other') === departmentKey);
  const agentKeys = new Set(deptAgents.map((a) => a.key));

  const deptTasks = tasks
    .filter((t) => agentKeys.has(t.agent))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const visibleTasks = deptTasks.slice(0, historyLimit);
  const hasMore = deptTasks.length > historyLimit;

  useEffect(() => {
    const prefill = searchParams.get('task');
    if (prefill) {
      setInput(prefill);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  useEffect(() => {
    setInput('');
    setSelectedAgent('auto');
    const defaults = {};
    for (const f of dept?.fields || []) {
      if (f.type === 'checkboxes' && f.options) {
        defaults[f.key] = f.options.map((o) => o.value);
      }
    }
    setExtraFields(defaults);
    setExpandedId(null);
    setMismatch(null);
    setError(null);
  }, [departmentKey]);

  function buildGoal() {
    let goal = input.trim();
    if (!goal) return '';
    const allFields = dept?.fields || [];
    const filled = allFields.filter((f) => {
      const val = extraFields[f.key];
      if (f.type === 'checkboxes') return Array.isArray(val) && val.length > 0;
      return val?.trim?.();
    });
    if (filled.length) {
      goal += '\n\nAdditional details:\n' + filled.map((f) => {
        const val = extraFields[f.key];
        if (f.type === 'checkboxes') {
          const labels = f.options.filter((o) => val.includes(o.value)).map((o) => o.label);
          return `- ${f.label}: ${labels.join(', ')}`;
        }
        return `- ${f.label}: ${val}`;
      }).join('\n');
    }
    return goal;
  }

  async function handleSubmit() {
    const goal = buildGoal();
    if (!goal || !connected || busy) return;

    setBusy(true);
    setMismatch(null);
    setError(null);
    setActiveTool(null);
    setAssistantReply('');

    try {
      // Explicit agent override bypasses the Assistant and goes straight to
      // that specific agent, same as before. "Auto" routes through the
      // Assistant with department scope, so Claude picks which agent in
      // this department handles it (and can ask clarifying questions).
      if (selectedAgent !== 'auto') {
        const result = await api.submitDepartmentGoal(goal, departmentKey, selectedAgent);
        if (result._mismatch) {
          setMismatch(result);
          return;
        }
      } else {
        let accumulated = '';
        await api.chatStream(goal, {
          scope: departmentKey,
          onEvent: (event) => {
            if (event.type === 'text_delta') {
              accumulated += event.text;
              setAssistantReply(accumulated);
            } else if (event.type === 'tool_start') {
              setActiveTool(event.name);
            } else if (event.type === 'tool_end') {
              setActiveTool(null);
            } else if (event.type === 'error') {
              setError(event.error);
            }
          },
        });
      }

      setInput('');
      setExtraFields({});
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      setActiveTool(null);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }

  async function copyResult(task) {
    const steps = Array.isArray(task.result) ? task.result : [task.result];
    const text = steps
      .map((s) => s?.text || s?.answer || (s ? JSON.stringify(s) : ''))
      .filter(Boolean)
      .join('\n\n');
    await navigator.clipboard.writeText(text);
    setCopied(task.id);
    setTimeout(() => setCopied(null), 2000);
  }

  function renderFooter(task) {
    const buttons = [];
    if (task.status === 'done' && task.result) {
      buttons.push(
        <button
          key="copy"
          onClick={(e) => { e.stopPropagation(); copyResult(task); }}
          className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          <Copy size={12} />
          {copied === task.id ? 'Copied!' : 'Copy result'}
        </button>,
      );
    }
    if (task.status === 'failed') {
      buttons.push(
        <button
          key="retry"
          onClick={(e) => { e.stopPropagation(); setInput(task.instruction); }}
          className="flex items-center gap-1 text-xs text-[var(--color-warning)] hover:text-[var(--color-text)] transition-colors"
        >
          <RotateCcw size={12} />
          Retry
        </button>,
      );
    }
    return buttons.length ? <div className="flex items-center gap-4">{buttons}</div> : null;
  }

  const fields = dept?.fields || [];
  const quickActions = dept?.quickActions || [];
  const placeholder = dept?.placeholder || 'What should this team do?';

  return (
    <div className="space-y-6 mb-8">
      <div className="rounded-lg border border-[var(--color-border)] p-4 space-y-3">
        <label className="text-sm font-medium text-[var(--color-text)]">
          What should the {dept?.label?.split('&')[0]?.trim() || ''} team do?
        </label>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={2}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]/50 resize-none"
        />

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--color-text-muted)]">Agent</label>
            <select
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
              className="text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 outline-none focus:border-[var(--color-accent)]/50"
            >
              <option value="auto">Auto (best in this team)</option>
              {deptAgents.map((a) => (
                <option key={a.key} value={a.key}>{a.role || a.key}</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleSubmit}
            disabled={!input.trim() || !connected || busy}
            className="ml-auto flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-[var(--color-accent)] text-black text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition shrink-0"
          >
            <Play size={13} />
            {busy ? 'Running…' : 'Run'}
          </button>
        </div>

        {quickActions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {quickActions.map((action) => (
              <button
                key={action}
                onClick={() => setInput(action)}
                className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)]/40 transition-colors"
              >
                <Sparkles size={10} />
                {action}
              </button>
            ))}
          </div>
        )}

        {fields.length > 0 && (
          <div className="grid sm:grid-cols-2 gap-2 pt-1">
            {fields.map((f) => (
              <div key={f.key} className={f.span === 2 ? 'sm:col-span-2' : ''}>
                <label className="text-[11px] text-[var(--color-text-muted)] mb-0.5 block">{f.label}</label>
                {f.type === 'checkboxes' ? (
                  <div className="flex flex-wrap gap-1.5">
                    {f.options.map((opt) => {
                      const selected = (extraFields[f.key] || []).includes(opt.value);
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setExtraFields((prev) => {
                            const cur = prev[f.key] || [];
                            return { ...prev, [f.key]: selected ? cur.filter((v) => v !== opt.value) : [...cur, opt.value] };
                          })}
                          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                            selected
                              ? 'border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                              : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-accent)]/40'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <input
                    value={extraFields[f.key] || ''}
                    onChange={(e) => setExtraFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]/50"
                  />
                )}
              </div>
            ))}
          </div>
        )}

        <div className="text-[11px] text-[var(--color-text-muted)]">Ctrl+Enter to run</div>
      </div>

      {(busy && selectedAgent === 'auto' && (activeTool || assistantReply)) && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm">
          {activeTool && (
            <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] mb-1.5">
              <span className="relative flex h-1.5 w-1.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-accent)] opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
              </span>
              Running {activeTool}…
            </div>
          )}
          {assistantReply && (
            <div className="whitespace-pre-wrap text-[var(--color-text)]">{assistantReply}</div>
          )}
        </div>
      )}

      {mismatch && (
        <div className="rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 p-4 flex items-start gap-3">
          <AlertTriangle size={16} className="text-[var(--color-warning)] shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-[var(--color-text)]">
              This looks like a <strong>{mismatch.suggestedLabel}</strong> task.
            </div>
            <Link
              to={`/departments/${mismatch.suggestedDepartment}?task=${encodeURIComponent(input)}`}
              className="text-xs text-[var(--color-accent)] hover:underline mt-1 inline-block"
            >
              Run it there instead &rarr;
            </Link>
          </div>
          <button
            onClick={() => setMismatch(null)}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 p-3 text-sm text-[var(--color-danger)]">
          {error}
        </div>
      )}

      {visibleTasks.length === 0 ? (
        <div className="text-sm text-[var(--color-text-muted)] py-8 text-center border border-dashed border-[var(--color-border)] rounded-lg">
          No tasks yet. Try one of the suggestions above.
        </div>
      ) : (
        <>
          <div>
            <h2 className="text-sm font-medium text-[var(--color-text-muted)] mb-3">Tasks</h2>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
              {visibleTasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  expanded={expandedId === task.id}
                  onToggle={(id) => setExpandedId(expandedId === id ? null : id)}
                  liveNarration={task.status === 'pending' ? liveNarration[task.id] : null}
                  renderFooter={renderFooter}
                />
              ))}
            </div>
          </div>

          {hasMore && (
            <button
              onClick={() => setHistoryLimit((l) => l + 20)}
              className="w-full py-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] border border-[var(--color-border)] rounded-lg hover:border-[var(--color-accent)]/40 transition-colors"
            >
              Load more
            </button>
          )}
        </>
      )}
    </div>
  );
}
