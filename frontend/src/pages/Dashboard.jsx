import { Link } from 'react-router-dom';
import { Radio, ArrowRight, Briefcase, CheckCircle2, Circle, Settings, Link2, MessageSquare } from 'lucide-react';
import { useStore } from '../store/useStore';
import StatCard from '../components/StatCard';
import StatusPill from '../components/StatusPill';

function OnboardingBanner({ onboarding }) {
  if (!onboarding) return null;
  const steps = [
    { done: onboarding.profileDone, label: 'Set up your business profile', to: '/settings', icon: Settings },
    { done: onboarding.connectionsDone, label: 'Connect an account', to: '/connections', icon: Link2 },
    { done: false, label: 'Send a test message', to: '/connections', icon: MessageSquare },
  ];

  const currentIdx = steps.findIndex((s) => !s.done);
  if (currentIdx === -1) return null;

  return (
    <div className="rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 p-4 mb-6">
      <div className="text-sm font-medium mb-3">Welcome! Let's get your workspace ready.</div>
      <div className="space-y-2">
        {steps.map((step, i) => {
          const Icon = step.done ? CheckCircle2 : Circle;
          const isCurrent = i === currentIdx;
          return (
            <Link
              key={step.label}
              to={step.to}
              className={`flex items-center gap-2.5 p-2 rounded-md transition-colors ${
                isCurrent
                  ? 'bg-[var(--color-accent)]/10 text-[var(--color-text)]'
                  : step.done
                    ? 'text-[var(--color-success)]'
                    : 'text-[var(--color-text-muted)]'
              } ${isCurrent ? 'hover:bg-[var(--color-accent)]/15' : ''}`}
            >
              <Icon size={16} className={step.done ? 'text-[var(--color-success)]' : isCurrent ? 'text-[var(--color-accent)]' : ''} />
              <span className={`text-sm ${step.done ? 'line-through' : ''}`}>{step.label}</span>
              {isCurrent && <ArrowRight size={14} className="ml-auto text-[var(--color-accent)]" />}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { summary, tasks } = useStore();
  const user = useStore((s) => s.user);
  const pending = tasks.filter((t) => t.status === 'pending_approval');
  const outreachPipelines = tasks.filter((t) => t.payload?.pipelineType === 'job_outreach_pipeline');
  const scheduledCalls = outreachPipelines.filter((t) => t.payload.stage === 'call_scheduled').length;

  return (
    <div className="p-4 md:p-6 max-w-5xl">
      <h1 className="font-[var(--font-display)] text-xl font-semibold mb-1">Overview</h1>
      <p className="text-sm text-[var(--color-text-muted)] mb-6">Your autonomous workforce, at a glance.</p>

      <OnboardingBanner onboarding={user?.onboarding} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <StatCard label="Active agents" value={summary.activeAgents} />
        <StatCard label="Tasks done" value={summary.tasks.done} />
        <StatCard label="Awaiting approval" value={summary.tasks.pending_approval} accent={summary.tasks.pending_approval > 0} />
        <StatCard label="Failed" value={summary.tasks.failed} />
      </div>

      {pending.length > 0 && (
        <div className="mb-8 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 p-4">
          <div className="text-sm font-medium mb-1 text-[var(--color-warning)]">
            {pending.length} action{pending.length > 1 ? 's' : ''} waiting on you
          </div>
          <div className="text-xs text-[var(--color-text-muted)]">
            Irreversible actions pause here until approved. Review them on the Tasks page.
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <h2 className="text-sm font-medium text-[var(--color-text-muted)] mb-3">Live activity</h2>
          <Link
            to="/console"
            className="group flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:border-[var(--color-accent)]/40 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-md bg-[var(--color-accent)]/10 flex items-center justify-center shrink-0">
                <Radio size={15} className="text-[var(--color-accent)]" />
              </div>
              <div>
                <div className="text-sm font-medium">Watch agents work in real time</div>
                <div className="text-xs text-[var(--color-text-muted)]">Live reasoning, tool calls, and results as they happen</div>
              </div>
            </div>
            <ArrowRight size={16} className="text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)] transition-colors shrink-0" />
          </Link>

          {outreachPipelines.length > 0 && (
            <Link
              to="/departments/sales/outreach"
              className="group flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:border-[var(--color-accent)]/40 transition-colors mt-3"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-md bg-[var(--color-accent)]/10 flex items-center justify-center shrink-0">
                  <Briefcase size={15} className="text-[var(--color-accent)]" />
                </div>
                <div>
                  <div className="text-sm font-medium">Job Outreach</div>
                  <div className="text-xs text-[var(--color-text-muted)]">
                    {outreachPipelines.length} opportunit{outreachPipelines.length === 1 ? 'y' : 'ies'} processed
                    {scheduledCalls > 0 ? ` · ${scheduledCalls} call${scheduledCalls > 1 ? 's' : ''} scheduled` : ''}
                  </div>
                </div>
              </div>
              <ArrowRight size={16} className="text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)] transition-colors shrink-0" />
            </Link>
          )}
        </div>

        <div>
          <h2 className="text-sm font-medium text-[var(--color-text-muted)] mb-3">Installed tools</h2>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-wrap gap-2">
            {summary.installedTools.map((t) => (
              <span key={t} className="text-xs font-[var(--font-mono)] px-2 py-1 rounded bg-[var(--color-surface-2)] border border-[var(--color-border)] text-[var(--color-text-muted)]">
                {t}
              </span>
            ))}
          </div>

          <h2 className="text-sm font-medium text-[var(--color-text-muted)] mb-3 mt-5">Providers</h2>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-wrap gap-2">
            {summary.availableProviders.map((p) => (
              <StatusPill key={p} status={p === 'mock' ? 'pending' : 'done'} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}