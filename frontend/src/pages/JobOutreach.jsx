import { useMemo } from 'react';
import { useStore } from '../store/useStore';
import StatCard from '../components/StatCard';
import StagePill from '../components/StagePill';

const REJECTED_STAGES = ['rejected_verification', 'rejected_contact'];
const IN_PROGRESS_STAGES = ['discovered', 'verification', 'verified', 'contact_found', 'outreach_drafted', 'awaiting_approval'];
const RESPONDED_STAGES = ['response_received', 'call_requested'];

export default function JobOutreach() {
  const tasks = useStore((s) => s.tasks);

  const pipelines = useMemo(
    () =>
      tasks
        .filter((t) => t.payload?.pipelineType === 'job_outreach_pipeline')
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    [tasks]
  );

  const counts = useMemo(() => {
    const c = { total: pipelines.length, verified: 0, rejected: 0, inProgress: 0, sent: 0, responded: 0, scheduled: 0 };
    for (const p of pipelines) {
      const stage = p.payload.stage;
      if (REJECTED_STAGES.includes(stage)) c.rejected++;
      else if (IN_PROGRESS_STAGES.includes(stage)) c.inProgress++;
      else if (stage === 'sent') c.sent++;
      else if (RESPONDED_STAGES.includes(stage)) c.responded++;
      else if (stage === 'call_scheduled') c.scheduled++;

      if (p.payload.verification?.status === 'VERIFIED') c.verified++;
    }
    return c;
  }, [pipelines]);

  const upcomingCalls = useMemo(
    () =>
      pipelines
        .filter((p) => p.payload.stage === 'call_scheduled' && p.payload.chosenSlot?.start)
        .sort((a, b) => new Date(a.payload.chosenSlot.start) - new Date(b.payload.chosenSlot.start)),
    [pipelines]
  );

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="font-[var(--font-display)] text-xl font-semibold mb-1">Job Outreach</h1>
      <p className="text-sm text-[var(--color-text-muted)] mb-6">
        Every opportunity that's gone through verification, outreach, and scheduling.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <StatCard label="Total processed" value={counts.total} />
        <StatCard label="Verified" value={counts.verified} />
        <StatCard label="Rejected" value={counts.rejected} />
        <StatCard label="Calls scheduled" value={counts.scheduled} accent={counts.scheduled > 0} />
      </div>

      {upcomingCalls.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-medium text-[var(--color-text-muted)] mb-3">Upcoming calls</h2>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] divide-y divide-[var(--color-border)]">
            {upcomingCalls.map((p) => {
              const slot = p.payload.chosenSlot;
              const meetLink = p.payload.calendarEventResult?.meetLink;
              const calendarUrl = p.payload.calendarEventResult?.calendarUrl;
              return (
                <div key={p.id} className="p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {p.payload.opportunity?.company} — {p.payload.opportunity?.jobTitle}
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                      {new Date(slot.start).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {meetLink && (
                      <a href={meetLink} target="_blank" rel="noreferrer" className="text-xs px-2.5 py-1 rounded-md border border-[var(--color-accent)]/30 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 transition-colors">
                        Join call
                      </a>
                    )}
                    {calendarUrl && (
                      <a href={calendarUrl} target="_blank" rel="noreferrer" className="text-xs px-2.5 py-1 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors">
                        View
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <h2 className="text-sm font-medium text-[var(--color-text-muted)] mb-3">All opportunities</h2>
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        {pipelines.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">
            No job opportunities processed yet.
          </div>
        ) : (
          <div className="divide-y divide-[var(--color-border)]">
            {pipelines.map((p) => {
              const opp = p.payload.opportunity || {};
              const verification = p.payload.verification;
              const isRejected = REJECTED_STAGES.includes(p.payload.stage);
              return (
                <div key={p.id} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{opp.company || 'Unknown company'}</div>
                      <div className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate">{opp.jobTitle || 'Unknown role'}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {verification && (
                        <span className="text-xs font-[var(--font-mono)] text-[var(--color-text-muted)]">{verification.score}/100</span>
                      )}
                      <StagePill stage={p.payload.stage} />
                    </div>
                  </div>
                  {isRejected && verification?.reasons?.length > 0 && (
                    <div className="text-xs text-[var(--color-text-muted)] mt-2 pl-0.5">
                      {verification.reasons[0]}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}