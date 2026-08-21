import { useState, useEffect } from 'react';
import { Workflow, Plus, Play, Trash2, Power, PowerOff, Clock, Calendar, LayoutTemplate, ArrowLeft } from 'lucide-react';
import { api } from '../services/api';
import { WORKFLOW_TEMPLATES } from '../data/workflowTemplates';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function describeSchedule(w) {
  if (w.scheduleType === 'interval') {
    return `Every ${w.intervalMinutes} minute${w.intervalMinutes === 1 ? '' : 's'}`;
  }
  const days = w.daysOfWeek?.length ? w.daysOfWeek.map((d) => DAY_LABELS[d]).join(', ') : 'every day';
  return `Daily at ${w.dailyTime} (${days})`;
}

function NewWorkflowForm({ template, onCreated, onCancel }) {
  const [name, setName] = useState(template?.name || '');
  const [goal, setGoal] = useState(template?.goal || '');
  const [scheduleType, setScheduleType] = useState(template?.scheduleType || 'interval');
  const [intervalMinutes, setIntervalMinutes] = useState(template?.intervalMinutes || 60);
  const [dailyTime, setDailyTime] = useState(template?.dailyTime || '09:00');
  const [daysOfWeek, setDaysOfWeek] = useState(template?.daysOfWeek || [1, 2, 3, 4, 5]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function toggleDay(d) {
    setDaysOfWeek((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  }

  async function submit() {
    if (!name.trim() || !goal.trim()) return setError('Name and goal are both required.');
    setBusy(true);
    setError(null);
    try {
      await api.createWorkflow({
        name: name.trim(),
        goal: goal.trim(),
        scheduleType,
        intervalMinutes: scheduleType === 'interval' ? Number(intervalMinutes) : undefined,
        dailyTime: scheduleType === 'daily' ? dailyTime : undefined,
        daysOfWeek: scheduleType === 'daily' ? daysOfWeek : undefined,
        enabled: true,
      });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 mb-4 space-y-3">
      {template && (
        <div className="flex items-start gap-2 text-xs text-[var(--color-accent)] bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/30 rounded-md px-3 py-2">
          <LayoutTemplate size={14} className="shrink-0 mt-0.5" />
          <span>
            Starting from <strong>{template.name}</strong> ({template.agentNote}). Replace the{' '}
            <code className="font-[var(--font-mono)]">[bracketed]</code> part of the goal below with your own details.
          </span>
        </div>
      )}
      <div>
        <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Weekly content ideas"
          className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-sm outline-none focus:border-[var(--color-accent)]/50"
        />
      </div>
      <div>
        <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Goal (exactly what you'd type in Chat)</label>
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Promote my bakery's weekly special"
          rows={2}
          className="w-full px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-sm outline-none focus:border-[var(--color-accent)]/50 resize-none"
        />
      </div>

      <div className="flex gap-2">
        {['interval', 'daily'].map((t) => (
          <button
            key={t}
            onClick={() => setScheduleType(t)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
              scheduleType === t
                ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent)]/10'
                : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
            }`}
          >
            {t === 'interval' ? 'Every N minutes' : 'Daily at a time'}
          </button>
        ))}
      </div>

      {scheduleType === 'interval' ? (
        <div>
          <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Run every (minutes)</label>
          <input
            type="number"
            min="1"
            value={intervalMinutes}
            onChange={(e) => setIntervalMinutes(e.target.value)}
            className="w-32 px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-sm outline-none focus:border-[var(--color-accent)]/50"
          />
        </div>
      ) : (
        <div className="space-y-2">
          <div>
            <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Time (server-local, HH:MM)</label>
            <input
              type="time"
              value={dailyTime}
              onChange={(e) => setDailyTime(e.target.value)}
              className="w-32 px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-sm outline-none focus:border-[var(--color-accent)]/50"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--color-text-muted)] mb-1 block">Days</label>
            <div className="flex gap-1">
              {DAY_LABELS.map((label, i) => (
                <button
                  key={i}
                  onClick={() => toggleDay(i)}
                  className={`w-9 h-9 rounded-md text-[11px] font-medium border ${
                    daysOfWeek.includes(i)
                      ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent)]/10'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {error && <div className="text-xs text-[var(--color-danger)]">{error}</div>}

      <div className="flex gap-2 pt-1">
        <button
          onClick={submit}
          disabled={busy}
          className="text-sm font-medium px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-black hover:brightness-110 disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create workflow'}
        </button>
        <button onClick={onCancel} className="text-sm px-3 py-1.5 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)]">
          Cancel
        </button>
      </div>
    </div>
  );
}

function WorkflowRow({ workflow, onChanged }) {
  const [busy, setBusy] = useState(false);

  async function run(action) {
    setBusy(true);
    try {
      if (action === 'toggle') await api.updateWorkflow(workflow.id, { enabled: !workflow.enabled });
      if (action === 'run-now') await api.runWorkflowNow(workflow.id);
      if (action === 'delete') {
        if (!window.confirm(`Delete "${workflow.name}"?`)) return;
        await api.deleteWorkflow(workflow.id);
      }
      onChanged();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--color-border)] last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{workflow.name}</span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
              workflow.enabled
                ? 'text-[var(--color-success)] border-[var(--color-success)]/30 bg-[var(--color-success)]/10'
                : 'text-[var(--color-text-muted)] border-[var(--color-border)]'
            }`}
          >
            {workflow.enabled ? 'enabled' : 'disabled'}
          </span>
        </div>
        <div className="text-[11px] text-[var(--color-text-muted)] truncate">{workflow.goal}</div>
        <div className="flex items-center gap-3 mt-1 text-[11px] text-[var(--color-text-muted)]">
          <span className="flex items-center gap-1">
            {workflow.scheduleType === 'interval' ? <Clock size={11} /> : <Calendar size={11} />}
            {describeSchedule(workflow)}
          </span>
          {workflow.lastRunAt && <span>Last ran {new Date(workflow.lastRunAt).toLocaleString()}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button disabled={busy} onClick={() => run('run-now')} title="Run now" className="p-1.5 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] disabled:opacity-40">
          <Play size={14} />
        </button>
        {workflow.enabled ? (
          <button disabled={busy} onClick={() => run('toggle')} title="Disable" className="p-1.5 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-warning)] disabled:opacity-40">
            <PowerOff size={14} />
          </button>
        ) : (
          <button disabled={busy} onClick={() => run('toggle')} title="Enable" className="p-1.5 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-success)] disabled:opacity-40">
            <Power size={14} />
          </button>
        )}
        <button disabled={busy} onClick={() => run('delete')} title="Delete" className="p-1.5 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-danger)] disabled:opacity-40">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

export default function Workflows() {
  const [workflows, setWorkflows] = useState([]);
  const [graphWorkflows, setGraphWorkflows] = useState([]);
  const [step, setStep] = useState('closed'); // 'closed' | 'templates' | 'form' | 'marketplace'
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [marketplaceEntries, setMarketplaceEntries] = useState([]);
  const [installingId, setInstallingId] = useState(null);
  const [loaded, setLoaded] = useState(false);

  async function refresh() {
    try {
      setWorkflows(await api.listWorkflows());
      setGraphWorkflows(await api.listWorkflowDefinitions());
    } catch {
      // backend not reachable - page still renders, just empty
    } finally {
      setLoaded(true);
    }
  }

  async function openMarketplace() {
    setStep('marketplace');
    try {
      setMarketplaceEntries(await api.searchWorkflowRegistry());
    } catch {
      setMarketplaceEntries([]);
    }
  }

  async function install(entryId) {
    setInstallingId(entryId);
    try {
      await api.installWorkflowFromRegistry(entryId);
      await refresh();
      setStep('closed');
    } catch (err) {
      alert(err.message);
    } finally {
      setInstallingId(null);
    }
  }

  async function runGraphWorkflow(id) {
    try {
      await api.runWorkflowDefinition(id);
      await refresh();
    } catch (err) {
      alert(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          {step !== 'closed' && (
            <button onClick={() => setStep('closed')} className="p-1 -ml-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
              <ArrowLeft size={16} />
            </button>
          )}
          <Workflow size={20} className="text-[var(--color-accent)]" />
          <h1 className="font-[var(--font-display)] text-xl font-semibold">Workflows</h1>
        </div>
        {step === 'closed' && (
          <button
            onClick={() => setStep('templates')}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-black hover:brightness-110"
          >
            <Plus size={14} /> New workflow
          </button>
        )}
      </div>
      <p className="text-sm text-[var(--color-text-muted)] mb-4">
        Any goal you'd type in Chat, run automatically on a schedule — checked every minute, no restart needed.
      </p>

      {step === 'templates' && (
        <div className="mb-4">
          <div className="flex gap-2 mb-3">
            <button
              onClick={() => { setSelectedTemplate(null); setStep('form'); }}
              className="flex-1 text-left rounded-lg border border-dashed border-[var(--color-border)] p-3 text-sm text-[var(--color-text-muted)] hover:border-[var(--color-accent)]/40 hover:text-[var(--color-text)] transition-colors"
            >
              Start from scratch instead →
            </button>
            <button
              onClick={openMarketplace}
              className="flex-1 text-left rounded-lg border border-dashed border-[var(--color-border)] p-3 text-sm text-[var(--color-text-muted)] hover:border-[var(--color-accent)]/40 hover:text-[var(--color-text)] transition-colors"
            >
              Browse the workflow marketplace →
            </button>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {WORKFLOW_TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => { setSelectedTemplate(t); setStep('form'); }}
                className="text-left rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5 hover:border-[var(--color-accent)]/40 transition-colors"
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[10px] font-[var(--font-mono)] uppercase tracking-wide text-[var(--color-accent)]">{t.category}</span>
                </div>
                <div className="text-sm font-medium mb-1">{t.name}</div>
                <div className="text-xs text-[var(--color-text-muted)] leading-relaxed">{t.description}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 'marketplace' && (
        <div className="mb-4">
          <p className="text-xs text-[var(--color-text-muted)] mb-3">
            These are real multi-step workflow graphs (branching, loops, approval checkpoints) - a different, more advanced kind of
            workflow than the simple templates above. There's no visual editor for them yet, but installed ones can be run and are
            listed below the simple workflows.
          </p>
          <div className="space-y-2">
            {marketplaceEntries.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[10px] font-[var(--font-mono)] uppercase tracking-wide text-[var(--color-accent)]">{entry.category}</span>
                      <span className="text-[10px] text-[var(--color-text-muted)]">· {entry.nodeCount} nodes</span>
                    </div>
                    <div className="text-sm font-medium mb-1">{entry.name}</div>
                    <div className="text-xs text-[var(--color-text-muted)] leading-relaxed">{entry.description}</div>
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {entry.nodeTypes.map((nt, i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)]">{nt}</span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => install(entry.id)}
                    disabled={installingId === entry.id}
                    className="shrink-0 text-sm font-medium px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-black hover:brightness-110 disabled:opacity-50"
                  >
                    {installingId === entry.id ? 'Installing…' : 'Install'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 'form' && (
        <NewWorkflowForm
          template={selectedTemplate}
          onCreated={() => { setStep('closed'); refresh(); }}
          onCancel={() => setStep('closed')}
        />
      )}

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        {!loaded ? null : workflows.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">
            No workflows yet — create one above. If you had the old GMAIL_TRIAGE_INTERVAL_MINUTES env
            var set, it migrates here automatically on the next backend restart.
          </div>
        ) : (
          workflows.map((w) => <WorkflowRow key={w.id} workflow={w} onChanged={refresh} />)
        )}
      </div>

      {graphWorkflows.length > 0 && (
        <div className="mt-6">
          <h2 className="text-xs uppercase tracking-wide text-[var(--color-text-muted)] font-[var(--font-mono)] mb-2">
            Graph workflows (installed from the marketplace)
          </h2>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
            {graphWorkflows.map((gw) => (
              <div key={gw.id} className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--color-border)] last:border-0">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{gw.name}</div>
                  <div className="text-[11px] text-[var(--color-text-muted)]">{gw.graph?.nodes?.length || 0} nodes</div>
                </div>
                <button
                  onClick={() => runGraphWorkflow(gw.id)}
                  className="shrink-0 flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
                >
                  <Play size={12} /> Run now
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
