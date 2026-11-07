import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Pencil, Trash2, Save, X, AlertCircle, HelpCircle } from 'lucide-react';
import EmptyState from '../EmptyState';
import { FieldTag, FieldError, FormSummary, invalidCls, a11y } from '../ui/FormField';
import { api } from '../../services/api';
import LoadingScreen from '../LoadingScreen';

// Settings -> General -> Q&A.
// Question/answer pairs the WhatsApp agent treats as approved answers.
// Each has an on/off switch; switched-off entries are never used.

const inputCls =
  'w-full px-3 py-2 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md focus:outline-none focus:border-[var(--color-accent)]';
const cardCls = 'bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-5';
const btnCls =
  'px-3 py-1.5 text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md hover:bg-[var(--color-surface-3)] flex items-center gap-1.5 disabled:opacity-50';
const primaryCls =
  'px-4 py-2 text-sm bg-[var(--color-accent)] text-black rounded-md hover:opacity-90 disabled:opacity-50 flex items-center gap-2 font-medium';

function errorText(err) {
  return err.details?.length ? `${err.message}\n• ${err.details.join('\n• ')}` : err.message;
}

function Toggle({ on, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={on ? 'On - the agent uses this answer' : 'Off - the agent ignores this answer'}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-emerald-500' : 'bg-[var(--color-surface-3)] border border-[var(--color-border)]'}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

function Entry({ entry, onSaved, onDeleted, limits }) {
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState(entry.question);
  const [a, setA] = useState(entry.answer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [editErrors, setEditErrors] = useState({});

  async function patch(fields) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.updateQa(entry.id, fields);
      onSaved(res.entry);
      setEditing(false);
    } catch (err) {
      setError(errorText(err));
    }
    setBusy(false);
  }

  async function remove() {
    if (!window.confirm(`Delete this Q&A entry?\n\n"${entry.question}"\n\nThis can't be undone. (Tip: switch it off instead if you might want it back.)`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteQa(entry.id);
      onDeleted(entry.id);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <li className={`p-4 rounded-md border border-[var(--color-border)] ${entry.enabled ? 'bg-[var(--color-surface-2)]' : 'bg-[var(--color-surface)] opacity-70'}`}>
      {editing ? (
        <div className="space-y-2">
          <div>
            <label htmlFor={`qa-q-${entry.id}`} className="text-xs font-medium text-[var(--color-text-muted)]">Question <FieldTag required /></label>
            <textarea rows={2} {...a11y(`qa-q-${entry.id}`, { required: true, error: editErrors.question })} className={`${inputCls} mt-1 ${invalidCls(editErrors.question)}`} value={q} maxLength={limits.question} onChange={(e) => setQ(e.target.value)} />
            <FieldError id={`qa-q-${entry.id}-error`}>{editErrors.question}</FieldError>
          </div>
          <div>
            <label htmlFor={`qa-a-${entry.id}`} className="text-xs font-medium text-[var(--color-text-muted)]">Answer <FieldTag required /></label>
            <textarea rows={4} {...a11y(`qa-a-${entry.id}`, { required: true, error: editErrors.answer })} className={`${inputCls} mt-1 ${invalidCls(editErrors.answer)}`} value={a} maxLength={limits.answer} onChange={(e) => setA(e.target.value)} />
            <FieldError id={`qa-a-${entry.id}-error`}>{editErrors.answer}</FieldError>
          </div>
          <div className="flex gap-2">
            <button type="button" className={btnCls} disabled={busy} onClick={() => {
              const problems = { question: q.trim() ? null : 'Question is required.', answer: a.trim() ? null : 'Answer is required.' };
              setEditErrors(problems);
              if (problems.question || problems.answer) return;
              patch({ question: q, answer: a });
            }}><Save size={12} /> Save</button>
            <button type="button" className={btnCls} disabled={busy} onClick={() => { setEditing(false); setQ(entry.question); setA(entry.answer); setError(null); }}><X size={12} /> Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <Toggle on={entry.enabled} disabled={busy} onChange={(on) => patch({ enabled: on })} label={`Use the answer to "${entry.question}"`} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
              {entry.question}
              {entry.source === 'correction' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-500 flex items-center gap-1" title="Saved with 'Correct this answer'"><Pencil size={10} /> from a correction</span>
              )}
              {!entry.enabled && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-3)] text-[var(--color-text-muted)]">off</span>}
            </div>
            <div className="text-sm text-[var(--color-text-muted)] whitespace-pre-wrap mt-1">{entry.answer}</div>
          </div>
          <div className="flex gap-1 shrink-0">
            <button type="button" className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" disabled={busy} onClick={() => setEditing(true)} title="Edit" aria-label="Edit"><Pencil size={14} /></button>
            <button type="button" className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-danger)]" disabled={busy} onClick={remove} title="Delete" aria-label="Delete"><Trash2 size={14} /></button>
          </div>
        </div>
      )}
      {error && <div className="mt-2 text-xs text-[var(--color-danger)] whitespace-pre-wrap">{error}</div>}
    </li>
  );
}

export default function QaTab() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [entries, setEntries] = useState([]);
  const [limits, setLimits] = useState({ question: 500, answer: 4000, entries: 1000 });
  const [search, setSearch] = useState('');
  const [newQ, setNewQ] = useState('');
  const [newA, setNewA] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState(null);
  const [addErrors, setAddErrors] = useState({});

  useEffect(() => {
    (async () => {
      try {
        const res = await api.listQa();
        setEntries(res.entries || []);
        if (res.limits) setLimits(res.limits);
      } catch (err) {
        if (err.body?.migrationMissing) setMigrationMissing(true);
        setLoadError(err.message);
      }
      setLoading(false);
    })();
  }, []);

  const shown = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return entries;
    return entries.filter((e) => {
      const text = `${e.question} ${e.answer}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [entries, search]);

  async function add(e) {
    e.preventDefault();
    setAddError(null);
    // Both are required: say which one is missing instead of sending nothing.
    const problems = { question: newQ.trim() ? null : 'Question is required.', answer: newA.trim() ? null : 'Answer is required.' };
    setAddErrors(problems);
    if (problems.question || problems.answer) {
      document.getElementById(problems.question ? 'qa-new-question' : 'qa-new-answer')?.focus();
      return;
    }
    setAdding(true);
    try {
      const res = await api.createQa({ question: newQ, answer: newA });
      setEntries((list) => [res.entry, ...list]);
      setNewQ('');
      setNewA('');
    } catch (err) {
      setAddError(errorText(err));
    }
    setAdding(false);
  }

  if (loading) return <LoadingScreen compact label="Loading Q&A entries…" />;

  if (loadError) {
    return (
      <div className={`${cardCls} text-sm flex items-start gap-2 text-[var(--color-danger)]`}>
        <AlertCircle size={16} className="mt-0.5 shrink-0" />
        <div>
          <div className="font-medium mb-1">{migrationMissing ? 'One setup step first' : "Couldn't load the Q&A entries"}</div>
          <div className="text-[var(--color-text-muted)]">{loadError}</div>
        </div>
      </div>
    );
  }

  const onCount = entries.filter((e) => e.enabled).length;

  return (
    <div className="space-y-6">
      <section className={cardCls}>
        <h2 className="text-sm font-semibold mb-1 flex items-center gap-2"><HelpCircle size={14} /> Add a question and answer</h2>
        <p className="text-xs text-[var(--color-text-muted)] mb-4">
          The WhatsApp agent treats these as approved answers and uses them from its next reply. Write the answer the way you'd want it said; the agent puts it in its own words.
        </p>
        <form onSubmit={add} noValidate className="space-y-3">
          <div>
            <label htmlFor="qa-new-question" className="text-xs font-medium text-[var(--color-text-muted)]">Question <FieldTag required /></label>
            <input {...a11y('qa-new-question', { required: true, error: addErrors.question })} className={`${inputCls} mt-1 ${invalidCls(addErrors.question)}`} value={newQ} maxLength={limits.question}
              onChange={(e) => { setNewQ(e.target.value); if (addErrors.question && e.target.value.trim()) setAddErrors((x) => ({ ...x, question: null })); }}
              placeholder="e.g. Do you deliver?" aria-label="New question" />
            <FieldError id="qa-new-question-error">{addErrors.question}</FieldError>
          </div>
          <div>
            <label htmlFor="qa-new-answer" className="text-xs font-medium text-[var(--color-text-muted)]">Answer <FieldTag required /></label>
            <textarea rows={3} {...a11y('qa-new-answer', { required: true, error: addErrors.answer })} className={`${inputCls} mt-1 ${invalidCls(addErrors.answer)}`} value={newA} maxLength={limits.answer}
              onChange={(e) => { setNewA(e.target.value); if (addErrors.answer && e.target.value.trim()) setAddErrors((x) => ({ ...x, answer: null })); }}
              placeholder="e.g. Yes, we deliver anywhere in Accra for GHS 20. Same-day if you order before 2pm." aria-label="New answer" />
            <FieldError id="qa-new-answer-error">{addErrors.answer}</FieldError>
          </div>
          <FormSummary missing={[addErrors.question && 'Question', addErrors.answer && 'Answer'].filter(Boolean)} />
          {addError && <div className="text-xs text-[var(--color-danger)] whitespace-pre-wrap">{addError}</div>}
          <button type="submit" className={primaryCls} disabled={adding}><Plus size={14} /> {adding ? 'Adding…' : 'Add'}</button>
        </form>
      </section>

      <section className={cardCls}>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <h2 className="text-sm font-semibold">
            Your Q&A <span className="font-normal text-[var(--color-text-muted)]">· {entries.length} {entries.length === 1 ? 'entry' : 'entries'}, {onCount} on</span>
          </h2>
          <div className="relative w-full sm:w-64">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input className={`${inputCls} pl-8`} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search questions and answers" aria-label="Search Q&A" />
          </div>
        </div>

        {entries.length === 0 ? (
          <EmptyState
            compact
            icon={HelpCircle}
            title="No questions and answers yet"
            text="Add the questions customers ask most - prices, delivery, opening hours, how to order. Your assistant uses these word for word."
            action={{ label: 'Add your first question', onClick: () => document.querySelector('[aria-label="New question"]')?.focus() }}
          />
        ) : shown.length === 0 ? (
          <div className="text-xs italic text-[var(--color-text-muted)]">Nothing matches "{search}".</div>
        ) : (
          <ul className="space-y-2">
            {shown.map((entry) => (
              <Entry
                key={entry.id}
                entry={entry}
                limits={limits}
                onSaved={(saved) => setEntries((list) => list.map((e) => (e.id === saved.id ? saved : e)))}
                onDeleted={(id) => setEntries((list) => list.filter((e) => e.id !== id))}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
