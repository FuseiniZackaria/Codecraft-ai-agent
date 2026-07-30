import { Check, X, ChevronDown, Trash2 } from 'lucide-react';
import StatusPill from './StatusPill';
import ResultStep from './ResultStep';
import TaskPayloadEditor from './TaskPayloadEditor';
import { useStore } from '../store/useStore';

export default function TaskRow({ task, expanded, onToggle }) {
  const { approveTask, rejectTask, deleteTask } = useStore();
  const needsApproval = task.status === 'pending_approval';
  const hasEditablePayload = needsApproval && task.payload && Object.keys(task.payload).length > 0;
  const hasResult = ['done', 'failed'].includes(task.status) && task.result;
  const isExpandable = hasResult || hasEditablePayload;

  function handleDelete(e) {
    e.stopPropagation();
    if (window.confirm('Delete this task? This can\'t be undone.')) {
      deleteTask(task.id);
    }
  }

  return (
    <div className="border-b border-[var(--color-border)] last:border-0">
      <button
        onClick={() => isExpandable && onToggle(task.id)}
        className={`w-full flex items-center justify-between gap-4 px-4 py-3 text-left ${isExpandable ? 'cursor-pointer hover:bg-[var(--color-surface-2)]/40' : 'cursor-default'} transition-colors`}
      >
        <div className="min-w-0 flex-1 flex items-center gap-2">
          {isExpandable && (
            <ChevronDown
              size={14}
              className={`text-[var(--color-text-muted)] shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
            />
          )}
          <div className="min-w-0">
            <div className="text-sm truncate">{task.instruction}</div>
            <div className="text-[11px] text-[var(--color-text-muted)] font-[var(--font-mono)] mt-0.5">
              {task.agent} · {new Date(task.created_at).toLocaleString()}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <StatusPill status={task.status} />
          {needsApproval && !hasEditablePayload && (
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => approveTask(task.id)}
                className="p-1.5 rounded-md border border-[var(--color-success)]/30 text-[var(--color-success)] hover:bg-[var(--color-success)]/10 transition-colors"
                aria-label="Approve task"
                title="Approve"
              >
                <Check size={14} />
              </button>
              <button
                onClick={() => rejectTask(task.id)}
                className="p-1.5 rounded-md border border-[var(--color-danger)]/30 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 transition-colors"
                aria-label="Reject task"
                title="Reject"
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
      </button>

      {expanded && hasEditablePayload && (
        <div className="px-4 pb-4 pl-9">
          <TaskPayloadEditor task={task} />
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
    </div>
  );
}
