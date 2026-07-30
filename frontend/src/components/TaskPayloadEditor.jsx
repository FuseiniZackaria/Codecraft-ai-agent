import { useState, useEffect } from 'react';
import { Check, X, Save } from 'lucide-react';
import { useStore } from '../store/useStore';

const HIDDEN_FIELDS = ['threadId', 'thingId'];
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
  'github.createRepository': ['name', 'description', 'private'],
};

export default function TaskPayloadEditor({ task }) {
  const { approveTask, rejectTask, updateTaskPayload } = useStore();
  const schema = TOOL_SCHEMAS[task.toolCall?.tool] || Object.keys(task.payload || {});
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
        Review before sending
      </div>

      {fields.map((key) => (
        <div key={key}>
          <label className="text-[11px] text-[var(--color-text-muted)] block mb-1">
            {FIELD_LABELS[key] || key}
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
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-[var(--color-success)]/40 text-[var(--color-success)] hover:bg-[var(--color-success)]/10"
            >
              <Check size={13} /> Approve & send
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
