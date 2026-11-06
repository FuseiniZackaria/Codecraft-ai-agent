import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, X, Save, CheckCircle2 } from 'lucide-react';
import { api } from '../../services/api';

// "Correct this answer" - used in the Test chat and the WhatsApp Inbox.
// Saves the right answer straight into the Q&A, so the agent uses it from its
// next reply. Correcting the same reply again updates that Q&A entry.

/** The customer's message(s) just before the reply at `index` (consecutive ones joined). */
export function questionBefore(messages, index, isCustomer) {
  const parts = [];
  for (let i = index - 1; i >= 0; i--) {
    if (isCustomer(messages[i])) parts.unshift(messages[i].body || '');
    else if (parts.length) break;
  }
  return parts.filter(Boolean).join('\n').trim();
}

export function CorrectedBadge() {
  return (
    <Link to="/settings?tab=qa" className="text-[10px] text-sky-500 flex items-center gap-1 hover:underline" title="Saved to your Q&A - click to see it">
      <CheckCircle2 size={10} /> Corrected - in your Q&A
    </Link>
  );
}

export function CorrectButton({ onClick, corrected }) {
  return (
    <button type="button" onClick={onClick}
      className="text-[11px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] flex items-center gap-1"
      title={corrected ? 'Change the saved correction' : 'Save the right answer to your Q&A'}>
      <Pencil size={11} /> {corrected ? 'Edit correction' : 'Correct this answer'}
    </button>
  );
}

/**
 * @param {object} props
 * @param {'test'|'whatsapp'} props.kind
 * @param {string} props.messageId
 * @param {string} props.question - prefilled: what the customer asked
 * @param {string} props.answer - prefilled: what the agent said (or its suggestion)
 */
export default function CorrectAnswerDialog({ kind, messageId, question: q0, answer: a0, onClose, onSaved }) {
  const [question, setQuestion] = useState(q0 || '');
  const [answer, setAnswer] = useState(a0 || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await api.saveCorrection({ kind, messageId, question, answer });
      onSaved?.(res.entry, res.created);
      onClose();
    } catch (err) {
      setError(err.details?.length ? err.details.join(' ') : err.message);
      setSaving(false);
    }
  }

  const inputCls = 'w-full px-3 py-2 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md focus:outline-none focus:border-[var(--color-accent)]';
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <form onSubmit={save} className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg max-w-xl w-full p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2"><Pencil size={16} /> Correct this answer</h3>
          <button type="button" onClick={onClose} className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" aria-label="Close"><X size={16} /></button>
        </div>
        <p className="text-xs text-[var(--color-text-muted)]">
          Write the answer you want. It's saved to your Q&A, and the agent uses it from its next reply.
          {kind === 'whatsapp' ? " This doesn't send anything to the customer - reply to them yourself below if needed." : ''}
        </p>
        <div>
          <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Customer's question</label>
          <textarea rows={2} className={inputCls} value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Do you deliver on Sundays?" />
          <div className="text-[11px] text-[var(--color-text-muted)] mt-1">Tip: write it the general way customers ask, not just this one message.</div>
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">The right answer</label>
          <textarea rows={4} className={inputCls} value={answer} maxLength={4000} onChange={(e) => setAnswer(e.target.value)} autoFocus />
        </div>
        {error && <div className="text-xs text-[var(--color-danger)]">{error}</div>}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm border border-[var(--color-border)] rounded-md hover:bg-[var(--color-surface-2)]">Cancel</button>
          <button type="submit" disabled={saving || !question.trim() || !answer.trim()}
            className="px-4 py-2 text-sm bg-[var(--color-accent)] text-black rounded-md hover:opacity-90 disabled:opacity-50 flex items-center gap-2 font-medium">
            <Save size={14} /> {saving ? 'Saving…' : 'Save to Q&A'}
          </button>
        </div>
      </form>
    </div>
  );
}
