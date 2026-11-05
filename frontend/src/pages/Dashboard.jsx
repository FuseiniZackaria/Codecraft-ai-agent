import { Link } from 'react-router-dom';
import {
  Radio, ArrowRight, Briefcase, CheckCircle2, Circle, Settings, Link2, MessageSquare, Gauge, Bot, Clock,
  AlertTriangle, PieChart, BarChart3, ListChecks, Zap, BookOpen, Inbox,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import Card, { PageHeader, HeaderButton } from '../components/ui/Card';
import { KpiCard, TaskStatusBar, TasksPerDayChart, RecentTasksTable } from '../components/dashboard/DashboardWidgets';
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
  const counts = summary.tasks || {};

  const quickLinks = [
    { to: '/chat', icon: MessageSquare, label: 'Chat with Ian', hint: 'Ask for anything in plain words' },
    { to: '/chat/console', icon: Radio, label: 'Watch agents live', hint: 'Reasoning, tool calls and results' },
    { to: '/work/inbox', icon: Inbox, label: 'WhatsApp inbox', hint: 'Conversations and replies' },
    { to: '/settings?tab=qa', icon: BookOpen, label: 'Agent knowledge', hint: 'Q&A, documents, test chat' },
    { to: '/toolbox/connections', icon: Link2, label: 'Connections', hint: 'Gmail, WhatsApp, Calendar and more' },
    ...(outreachPipelines.length
      ? [{
        to: '/departments/sales/outreach', icon: Briefcase, label: 'Job outreach',
        hint: `${outreachPipelines.length} processed${scheduledCalls ? ` · ${scheduledCalls} call${scheduledCalls > 1 ? 's' : ''} scheduled` : ''}`,
      }]
      : []),
  ];

  return (
    <div className="p-4 md:p-6 max-w-7xl">
      <PageHeader
        icon={Gauge}
        title="Dashboard"
        subtitle="Your autonomous workforce, at a glance."
        actions={(
          <>
            <HeaderButton as={Link} to="/chat" variant="primary" icon={MessageSquare}>Open chat</HeaderButton>
            <HeaderButton as={Link} to="/work" variant="accent" icon={ListChecks}>Review tasks</HeaderButton>
          </>
        )}
      />

      <OnboardingBanner onboarding={user?.onboarding} />

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiCard tone="navy" icon={Bot} label="Active agents" value={summary.activeAgents} to="/departments" />
        <KpiCard tone="green" icon={CheckCircle2} label="Tasks done" value={counts.done ?? 0} to="/work" />
        <KpiCard tone="orange" icon={Clock} label="Awaiting approval" shortLabel="Awaiting you" value={counts.pending_approval ?? 0} to="/work" linkLabel="Review" />
        <KpiCard tone="red" icon={AlertTriangle} label="Failed" value={counts.failed ?? 0} to="/work" />
      </div>

      {pending.length > 0 && (
        <div className="mb-5 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-4 py-3 flex items-center gap-3 flex-wrap">
          <Clock size={16} className="text-[var(--color-warning)] shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">{pending.length} action{pending.length > 1 ? 's' : ''} waiting on you</div>
            <div className="text-xs text-[var(--color-text-muted)]">Irreversible actions pause here until you approve them.</div>
          </div>
          <HeaderButton as={Link} to="/work" variant="primary">Review now</HeaderButton>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-5 mb-5">
        <Card title="Task status" icon={PieChart} action={<Link to="/work" className="text-[var(--color-accent)] font-medium hover:underline">View tasks</Link>}>
          <TaskStatusBar counts={counts} />
        </Card>
        <Card title="Tasks per day" icon={BarChart3} action={<Link to="/home/analytics" className="text-[var(--color-accent)] font-medium hover:underline">Analytics</Link>}>
          <TasksPerDayChart tasks={tasks} />
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <Card title="Recent tasks" icon={ListChecks} className="lg:col-span-2" bodyClassName="">
          <RecentTasksTable tasks={tasks} StatusPill={StatusPill} />
        </Card>

        <div className="space-y-5">
          <Card title="Quick actions" icon={Zap} bodyClassName="p-2">
            <ul>
              {quickLinks.map((q) => {
                const Icon = q.icon;
                return (
                  <li key={q.to}>
                    <Link to={q.to} className="group flex items-center gap-3 px-3 py-2.5 rounded-md hover:bg-[var(--color-surface-2)] transition-colors">
                      <span className="w-8 h-8 rounded-md bg-[var(--color-accent)]/12 text-[var(--color-accent)] flex items-center justify-center shrink-0" style={{ background: 'var(--color-accent-dim)' }}>
                        <Icon size={15} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium truncate">{q.label}</span>
                        <span className="block text-xs text-[var(--color-text-muted)] truncate">{q.hint}</span>
                      </span>
                      <ArrowRight size={14} className="text-[var(--color-text-muted)] group-hover:text-[var(--color-accent)] transition-colors shrink-0" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
