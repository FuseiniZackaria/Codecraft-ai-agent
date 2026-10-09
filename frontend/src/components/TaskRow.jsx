import { Check, X, ChevronDown, Trash2 } from 'lucide-react';
import StatusPill from './StatusPill';
import ResultStep from './ResultStep';
import TaskPayloadEditor from './TaskPayloadEditor';
import { useStore } from '../store/useStore';

export default function TaskRow({ task, expanded, onToggle, liveNarration, renderFooter, selectable, isSelected, onSelect }) {
  const { approveTask, rejectTask, deleteTask, resumeWorkflowRun, cancelWorkflowRun } = useStore();
  const needsApproval = task.status === 'pending_approval';
  const isWorkflowTask = !!task.workflowRunId;
  const hasEditablePayload = needsApproval && !isWorkflowTask && task.payload && Object.keys(task.payload).length > 0;
  const hasWorkflowPreview = isWorkflowTask && task.payload?.preview;
  const hasResult = ['done', 'failed'].includes(task.status) && task.result;
  const isPipelineTask = task.agent === 'outreach-pipeline' && task.payload?.stage;
  const isExpandable = hasResult || hasEditablePayload || hasWorkflowPreview || isPipelineTask;

  function handleDelete(e) {
    e.stopPropagation();
    if (window.confirm('Delete this task? This can\'t be undone.')) {
      deleteTask(task.id);
    }
  }

  function handleApprove() {
    if (isWorkflowTask) resumeWorkflowRun(task.workflowRunId);
    else approveTask(task.id);
  }

  function handleReject() {
    if (isWorkflowTask) cancelWorkflowRun(task.workflowRunId);
    else rejectTask(task.id);
  }

  return (
    <div className="border-b border-[var(--color-border)] last:border-0">
      <div
        role="button"
        tabIndex={isExpandable ? 0 : -1}
        onClick={() => isExpandable && onToggle(task.id)}
        onKeyDown={(e) => {
          if (isExpandable && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onToggle(task.id);
          }
        }}
        className={`w-full flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-4 px-4 py-3 text-left ${isExpandable ? 'cursor-pointer hover:bg-[var(--color-surface-2)]/40' : 'cursor-default'} transition-colors`}
      >
        <div className="min-w-0 flex-1 flex items-center gap-2">
          {!task.read && (
            <span className="w-2 h-2 rounded-full bg-[var(--color-accent)] shrink-0" title="Unread" />
          )}
          {selectable && (
            <input
              type="checkbox"
              checked={!!isSelected}
              onChange={(e) => { e.stopPropagation(); onSelect?.(); }}
              onClick={(e) => e.stopPropagation()}
              className="accent-[var(--color-accent)] shrink-0 cursor-pointer"
            />
          )}
          {isExpandable && (
            <ChevronDown
              size={14}
              className={`text-[var(--color-text-muted)] shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm break-words">{task.instruction}</div>
            {liveNarration ? (
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="relative flex h-1.5 w-1.5 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-accent)] opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
                </span>
                <div className="text-[11px] text-[var(--color-text)] italic truncate">{liveNarration}</div>
              </div>
            ) : (
              <div className="text-[11px] text-[var(--color-text-muted)] font-[var(--font-mono)] mt-0.5 break-words">
                {task.agent} · {new Date(task.created_at).toLocaleString()}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0 self-end sm:self-auto">
          <StatusPill status={task.status} />
          {needsApproval && !hasEditablePayload && (
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={handleApprove}
                className="p-1.5 rounded-md border border-[var(--color-success)]/30 text-[var(--color-success)] hover:bg-[var(--color-success)]/10 transition-colors"
                aria-label={isWorkflowTask ? 'Resume workflow' : 'Approve task'}
                title={isWorkflowTask ? 'Approve & resume workflow' : 'Approve'}
              >
                <Check size={14} />
              </button>
              <button
                onClick={handleReject}
                className="p-1.5 rounded-md border border-[var(--color-danger)]/30 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 transition-colors"
                aria-label={isWorkflowTask ? 'Cancel workflow' : 'Reject task'}
                title={isWorkflowTask ? 'Reject & cancel workflow' : 'Reject'}
              >
                <X size={14} />
              </button>
            </div>
          )}
          <button
            onClick={handleDelete}
            className="p-1.5 rounded-md border border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:border-[var(--color-danger)]/30 hover:bg-[var(--color-danger)]/10 transition-colors"
            aria-label="Delete task"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {expanded && hasEditablePayload && (
        <div className="px-4 pb-4 pl-9">
          <TaskPayloadEditor task={task} />
        </div>
      )}

      {expanded && hasWorkflowPreview && (
        <div className="px-4 pb-4 pl-9">
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
            <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] font-[var(--font-mono)] mb-1.5">
              {task.payload.previewType === 'video' ? 'Review before approving' : 'Workflow checkpoint — what happened so far'}
            </div>
            {task.payload.previewType === 'video' ? (
              <video controls className="w-full rounded-md max-h-[480px] bg-black" src={task.payload.preview}>
                Your browser can't play this video inline — open it directly: {task.payload.preview}
              </video>
            ) : (
              <div className="text-xs text-[var(--color-text)] whitespace-pre-wrap">{task.payload.preview}</div>
            )}
          </div>
        </div>
      )}

      {expanded && isPipelineTask && (
        <div className="px-4 pb-4 pl-9 space-y-2">
          {(() => {
            const p = task.payload;
            const v = p.verification;
            const opp = p.opportunity || {};
            return (
              <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] font-[var(--font-mono)]">Stage</span>
                  <span className="font-medium">{p.stage?.replace(/_/g, ' ')}</span>
                </div>
                {opp.applicationUrl && (
                  <div className="flex gap-2 min-w-0">
                    <span className="text-[var(--color-text-muted)] shrink-0">URL</span>
                    <a href={opp.applicationUrl} target="_blank" rel="noreferrer" className="text-[var(--color-accent)] truncate hover:underline">{opp.applicationUrl}</a>
                  </div>
                )}
                {v && (
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-[var(--color-text-muted)]">Score</span>
                    <span className={`font-[var(--font-mono)] font-semibold ${v.score >= 75 ? 'text-[var(--color-success)]' : v.score >= 50 ? 'text-[var(--color-warning)]' : 'text-[var(--color-danger)]'}`}>{v.score}/100</span>
                    <span className="text-[var(--color-text-muted)]">{v.tier}</span>
                    {v.companyVerified && <span className="text-[var(--color-success)]">✓ company</span>}
                    {v.applicationUrlVerified && <span className="text-[var(--color-success)]">✓ listing</span>}
                  </div>
                )}
                {p.applySkipReason && (
                  <div className="rounded border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 px-2 py-1.5 text-[var(--color-warning)]">
                    <span className="font-medium">Skip reason: </span>{p.applySkipReason}
                  </div>
                )}
                {v?.reasons?.length > 0 && (
                  <ul className="space-y-0.5 text-[var(--color-text-muted)]">
                    {v.reasons.map((r, i) => <li key={i}>· {r}</li>)}
                  </ul>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {expanded && hasResult && (
        <div className="px-4 pb-4 pl-9 space-y-4">
          {task.status === 'failed' ? (
            <div className="rounded-md border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 p-3">
              <div className="text-[10px] uppercase tracking-wide text-[var(--color-danger)] font-[var(--font-mono)] mb-1.5">
                Error
              </div>
              <div className="text-xs text-[var(--color-danger)] break-words">
                {task.result?.error || JSON.stringify(task.result)}
              </div>
            </div>
          ) : (
            (Array.isArray(task.result) ? task.result : [task.result]).map((step, i) => (
              <div key={i} className="border-l-2 border-[var(--color-border)] pl-3">
                <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] font-[var(--font-mono)] mb-1.5">
                  Step {i + 1}
                </div>
                <ResultStep step={step} index={i} />
              </div>
            ))
          )}
        </div>
      )}

      {expanded && renderFooter && (
        <div className="px-4 pb-3 pl-9">
          {renderFooter(task)}
        </div>
      )}
    </div>
  );
}
