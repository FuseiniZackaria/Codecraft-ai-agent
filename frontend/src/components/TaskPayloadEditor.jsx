import { useState, useEffect } from 'react';
import { Check, X, Save, AlertTriangle, ShieldAlert, Link2 } from 'lucide-react';
import { useStore } from '../store/useStore';

const HIDDEN_FIELDS = ['threadId', 'thingId', 'lead', 'platform'];
const TEXTAREA_FIELDS = ['body', 'text'];

const FIELD_LABELS = {
  to: 'To',
  subject: 'Subject',
  body: 'Message',
  recipientEmail: 'To',
  text: 'Reply',
  name: 'Repository name',
  description: 'Description',
  private: 'Private (true/false)',
};

// Full expected field set per tool, so a field extraction dropped (e.g. no
// explicit subject in the original request) still shows up empty and
// fillable, rather than silently disappearing from the editor.
const TOOL_SCHEMAS = {
  'gmail.sendEmail': ['to', 'subject', 'body'],
  'gmail.replyToThread': ['recipientEmail', 'body'],
  'reddit.postComment': ['text'],
  'whatsapp.sendMessage': ['to', 'body'],
  'telegram.sendMessage': ['to', 'body'],
  'social.prepareDM': ['to', 'body'],
  'github.createRepository': ['name', 'description', 'private'],
};

// Fields that MUST be non-empty before an approval card is sendable. If any
// of these is blank the Approve button is disabled and the "missing" banner
// explains what to fill in before approving.
const REQUIRED_FIELDS = {
  'gmail.sendEmail': ['to', 'subject', 'body'],
  'gmail.replyToThread': ['recipientEmail', 'body'],
  'whatsapp.sendMessage': ['to', 'body'],
  'telegram.sendMessage': ['to', 'body'],
  'social.prepareDM': ['to', 'body'],
};

function JobApplyPreview({ task }) {
  const { approveTask, rejectTask } = useStore();
  const fields = task.payload?.fields || [];
  return (
    <div className="rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 p-3 space-y-3">
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-warning)] font-[var(--font-mono)]">
        Review before submitting
      </div>
      <div className="space-y-1">
        {fields.map((f, i) => (
          <div key={i} className="flex gap-2 text-xs">
            <span className="text-[var(--color-text-muted)] font-[var(--font-mono)] shrink-0 truncate max-w-[40%]">{f.selector}</span>
            <span className="text-[var(--color-text)] truncate">{String(f.value).length > 100 ? String(f.value).slice(0, 100) + '…' : f.value}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => approveTask(task.id)}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-[var(--color-success)]/40 text-[var(--color-success)] hover:bg-[var(--color-success)]/10"
        >
          <Check size={13} /> Approve & submit
        </button>
        <button
          onClick={() => rejectTask(task.id)}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-[var(--color-danger)]/40 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
        >
          <X size={13} /> Reject
        </button>
      </div>
    </div>
  );
}

function LeadDetailsPanel({ lead }) {
  if (!lead) return null;
  const sources = Array.isArray(lead.sources) ? lead.sources : [];
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 space-y-1.5 text-[11px]">
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] font-[var(--font-mono)]">
        Lead details
      </div>
      {lead.name && <div><span className="text-[var(--color-text-muted)]">Name:</span> {lead.name}</div>}
      {lead.reason && <div><span className="text-[var(--color-text-muted)]">Why contact:</span> {lead.reason}</div>}
      {lead.offer && <div><span className="text-[var(--color-text-muted)]">Offer:</span> {lead.offer}</div>}
      {lead.confidence && (
        <div>
          <span className="text-[var(--color-text-muted)]">Confidence:</span>{' '}
          <span className={lead.confidence === 'high' ? 'text-[var(--color-success)]' : lead.confidence === 'low' ? 'text-[var(--color-warning)]' : ''}>
            {lead.confidence}
          </span>
          {lead.confidenceReason && <> — <span className="text-[var(--color-text-muted)]">{lead.confidenceReason}</span></>}
        </div>
      )}
      {sources.length > 0 && (
        <div className="flex gap-1 flex-wrap items-center">
          <span className="text-[var(--color-text-muted)]">Found at:</span>
          {sources.map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noreferrer"
               className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline break-all">
              <Link2 size={10} /> {url.length > 50 ? `${url.slice(0, 50)}…` : url}
            </a>
          ))}
        </div>
      )}
      {lead.contactSource && (
        <div className="break-all">
          <span className="text-[var(--color-text-muted)]">Contact source:</span>{' '}
          <a href={lead.contactSource} target="_blank" rel="noreferrer" className="text-[var(--color-accent)] hover:underline">
            {lead.contactSource}
          </a>
        </div>
      )}
    </div>
  );
}

export default function TaskPayloadEditor({ task }) {
  const { approveTask, rejectTask, updateTaskPayload } = useStore();

  if (task.toolCall?.tool === 'browser.applyForJob') {
    return <JobApplyPreview task={task} />;
  }

  const tool = task.toolCall?.tool;
  const schema = TOOL_SCHEMAS[tool] || Object.keys(task.payload || {});
  const initialValues = Object.fromEntries(schema.map((k) => [k, task.payload?.[k] || '']));
  const [values, setValues] = useState(initialValues);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (dirty) return; // never overwrite unsaved local edits with a background poll
    setValues(Object.fromEntries(schema.map((k) => [k, task.payload?.[k] || ''])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.payload, dirty]);

  const fields = schema.filter((k) => !HIDDEN_FIELDS.includes(k));
  if (fields.length === 0) return null;

  const required = REQUIRED_FIELDS[tool] || [];
  const missing = required.filter((k) => !(values[k] || '').toString().trim());
  const canApprove = missing.length === 0 && !dirty;

  const isSocialPrepareOnly = tool === 'social.prepareDM';
  const lead = task.payload?.lead || null;

  async function handleSave() {
    setSaving(true);
    try {
      await updateTaskPayload(task.id, values);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 p-3 space-y-3">
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-warning)] font-[var(--font-mono)]">
        Review before {isSocialPrepareOnly ? 'copying' : 'sending'}
      </div>

      {lead && (
        <div className="rounded-md border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/5 p-2.5 flex items-start gap-2 text-[11px] text-[var(--color-text)]">
          <ShieldAlert size={13} className="shrink-0 mt-0.5 text-[var(--color-accent)]" />
          <span>
            This recipient is a <strong>sales lead</strong>. Their replies belong to the Sales team's response flow,
            not inbox triage.
          </span>
        </div>
      )}

      {isSocialPrepareOnly && (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2.5 flex items-start gap-2 text-[11px] text-[var(--color-text-muted)]">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>
            Social DMs are approval-only — approve to mark as sent, then copy the message and paste it into
            {task.payload?.platform ? ` ${task.payload.platform}` : ' the platform'} yourself. No automated send runs.
          </span>
        </div>
      )}

      {fields.map((key) => (
        <div key={key}>
          <label className="text-[11px] text-[var(--color-text-muted)] block mb-1">
            {FIELD_LABELS[key] || key}
            {required.includes(key) && !(values[key] || '').toString().trim() && (
              <span className="text-[var(--color-danger)] ml-1">• missing</span>
            )}
          </label>
          {TEXTAREA_FIELDS.includes(key) ? (
            <textarea
              value={values[key] || ''}
              onChange={(e) => {
                setValues({ ...values, [key]: e.target.value });
                setDirty(true);
              }}
              rows={5}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2 text-sm outline-none focus:border-[var(--color-accent)]/50 resize-y"
            />
          ) : (
            <input
              value={values[key] || ''}
              onChange={(e) => {
                setValues({ ...values, [key]: e.target.value });
                setDirty(true);
              }}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]/50"
            />
          )}
        </div>
      ))}

      <LeadDetailsPanel lead={lead} />

      {missing.length > 0 && (
        <div className="flex items-start gap-2 text-[11px] text-[var(--color-danger)]">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>Fill in {missing.map((k) => FIELD_LABELS[k] || k).join(', ')} before approving — or reject this draft.</span>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        {dirty ? (
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-black disabled:opacity-50"
          >
            <Save size={13} />
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        ) : (
          <>
            <button
              onClick={() => approveTask(task.id)}
              disabled={!canApprove}
              title={!canApprove ? 'Fill the missing fields before approving' : undefined}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-[var(--color-success)]/40 text-[var(--color-success)] hover:bg-[var(--color-success)]/10 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Check size={13} /> {isSocialPrepareOnly ? 'Approve (mark as sent)' : 'Approve & send'}
            </button>
            <button
              onClick={() => rejectTask(task.id)}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-[var(--color-danger)]/40 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
            >
              <X size={13} /> Reject
            </button>
          </>
        )}
        {dirty && (
          <span className="text-[11px] text-[var(--color-text-muted)]">Unsaved changes — save before approving</span>
        )}
      </div>
    </div>
  );
}
