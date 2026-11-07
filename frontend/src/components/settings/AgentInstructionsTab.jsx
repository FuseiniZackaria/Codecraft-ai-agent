import { useEffect, useMemo, useState } from 'react';
import { UserRound, Save, Plus, Trash2, History, RotateCcw, Eye, X, AlertCircle, CheckCircle2, MessageSquare, Info } from 'lucide-react';
import { api } from '../../services/api';
import { FieldTag, FieldError, FormSummary, invalidCls, a11y } from '../ui/FormField';
import LoadingScreen from '../LoadingScreen';

// Settings -> General -> Agent instructions.
// One set per workspace (business). Every save is kept as a version, and the
// WhatsApp agent uses the newest one from its very next reply.

const inputCls =
  'w-full px-3 py-2 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md focus:outline-none focus:border-[var(--color-accent)]';
const cardCls = 'bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-5';
const btnCls =
  'px-3 py-1.5 text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md hover:bg-[var(--color-surface-3)] flex items-center gap-1.5 disabled:opacity-50';

function toForm(active) {
  return {
    agent_name: active?.agent_name || 'Ian',
    instructions: active?.instructions || '',
    hold_reply: active?.hold_reply || '',
    examples: (active?.examples || []).map((e) => ({ customer: e.customer || '', reply: e.reply || '' })),
  };
}

function when(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export default function AgentInstructionsTab() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [source, setSource] = useState(null); // saved | default | file
  const [activeVersion, setActiveVersion] = useState(null);
  const [versions, setVersions] = useState([]);
  const [limits, setLimits] = useState({ instructions: 20000, examples: 30 });
  const [form, setForm] = useState(toForm(null));
  const [original, setOriginal] = useState(toForm(null));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [savedMsg, setSavedMsg] = useState(null);
  const [preview, setPreview] = useState(null); // a full old version
  const [busyVersion, setBusyVersion] = useState(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    setMigrationMissing(false);
    try {
      const res = await api.getAgentSettings();
      const f = toForm(res.active);
      setForm(f);
      setOriginal(f);
      setSource(res.active?.source || null);
      setActiveVersion(res.active?.version || null);
      setVersions(res.versions || []);
      if (res.limits) setLimits(res.limits);
    } catch (err) {
      if (err.body?.migrationMissing) setMigrationMissing(true);
      setLoadError(err.message);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(original), [form, original]);

  // A field's message clears as soon as it's filled in.
  const clearError = (...keys) => setFieldErrors((x) => {
    if (!keys.some((k) => x[k])) return x;
    const next = { ...x };
    for (const k of keys) delete next[k];
    return next;
  });
  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    setSavedMsg(null);
    if (String(value).trim()) clearError(key);
  }
  function setExample(i, key, value) {
    setForm((f) => ({ ...f, examples: f.examples.map((e, j) => (j === i ? { ...e, [key]: value } : e)) }));
    setSavedMsg(null);
    if (String(value).trim()) clearError(`ex-${i}-${key}`);
  }
  function addExample() {
    setForm((f) => ({ ...f, examples: [...f.examples, { customer: '', reply: '' }] }));
  }
  function removeExample(i) {
    setForm((f) => ({ ...f, examples: f.examples.filter((_, j) => j !== i) }));
    setSavedMsg(null);
    // Example numbers shift: drop the example messages (they come back on the next Save if still needed).
    setFieldErrors((x) => Object.fromEntries(Object.entries(x).filter(([k]) => !k.startsWith('ex-'))));
  }

  /** Agent's name and instructions are required; an example needs both halves (or neither). */
  function formErrors(f) {
    const e = {};
    if (!String(f.agent_name || '').trim()) e.agent_name = "The agent's name is required.";
    if (!String(f.instructions || '').trim()) e.instructions = 'The instructions are required.';
    else if (f.instructions.length > limits.instructions) e.instructions = `The instructions are too long (max ${limits.instructions.toLocaleString()} characters).`;
    f.examples.forEach((ex, i) => {
      const c = String(ex.customer || '').trim();
      const r = String(ex.reply || '').trim();
      if (c && !r) e[`ex-${i}-reply`] = 'Add the reply too - or remove this example.';
      if (r && !c) e[`ex-${i}-customer`] = 'Add what the customer says too - or remove this example.';
    });
    return e;
  }

  async function save() {
    setError(null);
    setSavedMsg(null);
    const problems = formErrors(form);
    setFieldErrors(problems);
    if (Object.keys(problems).length) {
      const order = ['agent_name', 'instructions', ...form.examples.flatMap((_, i) => [`ex-${i}-customer`, `ex-${i}-reply`])];
      const first = order.find((k) => problems[k]);
      const el = document.getElementById(first === 'agent_name' || first === 'instructions' ? first : `agent-${first}`);
      el?.focus();
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    setSaving(true);
    try {
      const res = await api.saveAgentSettings({ ...form, note });
      setNote('');
      await load();
      setSavedMsg(`Saved as version ${res.saved.version}. The WhatsApp agent uses it from its next reply.`);
    } catch (err) {
      setError(err.details?.length ? `${err.message}\n• ${err.details.join('\n• ')}` : err.message);
    }
    setSaving(false);
  }

  async function openPreview(id) {
    setBusyVersion(id);
    setError(null);
    try {
      const res = await api.getAgentSettingsVersion(id);
      setPreview(res.version);
    } catch (err) {
      setError(err.message);
    }
    setBusyVersion(null);
  }

  async function rollBack(v) {
    const warn = dirty ? '\n\nYour unsaved changes on this page will be lost.' : '';
    if (!window.confirm(`Roll back to version ${v.version}?\n\nIt will be saved again as the newest version, and the agent uses it from its next reply. Nothing in the history is deleted.${warn}`)) return;
    setBusyVersion(v.id);
    setError(null);
    try {
      const res = await api.restoreAgentSettingsVersion(v.id);
      setPreview(null);
      await load();
      setSavedMsg(`Rolled back: version ${v.version} is now in use again (saved as version ${res.saved.version}).`);
    } catch (err) {
      setError(err.message);
    }
    setBusyVersion(null);
  }

  if (loading) return <LoadingScreen compact label="Loading the agent's instructions…" />;

  if (loadError) {
    return (
      <div className={`${cardCls} text-sm`}>
        <div className="flex items-start gap-2 text-[var(--color-danger)]">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-medium mb-1">{migrationMissing ? 'One setup step first' : "Couldn't load the agent's instructions"}</div>
            <div className="text-[var(--color-text-muted)] whitespace-pre-wrap">{loadError}</div>
            {migrationMissing && (
              <ol className="list-decimal ml-5 mt-2 text-[var(--color-text-muted)] space-y-0.5">
                <li>Open Supabase → SQL Editor → New query.</li>
                <li>Paste the file <code>backend/database/migrations/0006_knowledge_base.sql</code> and click Run.</li>
                <li>Come back and refresh this page.</li>
              </ol>
            )}
          </div>
        </div>
      </div>
    );
  }

  const overLimit = form.instructions.length > limits.instructions;
  const missing = [fieldErrors.agent_name && "Agent's name", fieldErrors.instructions && !form.instructions.trim() && 'Instructions'].filter(Boolean);
  const exampleProblems = form.examples.map((_, i) => (fieldErrors[`ex-${i}-customer`] || fieldErrors[`ex-${i}-reply`] ? `Example ${i + 1}` : null)).filter(Boolean);
  const invalid = [...(fieldErrors.instructions && form.instructions.trim() ? ['Instructions (too long)'] : []), ...exampleProblems];

  return (
    <div className="space-y-6">
      {source !== 'saved' && (
        <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-md text-sm">
          <Info size={14} className="mt-0.5 shrink-0 text-amber-500" />
          <span>
            {source === 'file'
              ? "The agent is using the built-in rules file for now. Edit below and save to switch to your own instructions."
              : "Nothing saved yet - this is a starting template. Read it through, adjust it for your business and click Save to make it version 1."}
          </span>
        </div>
      )}

      <section className={cardCls}>
        <h2 className="text-sm font-semibold mb-1 flex items-center gap-2"><UserRound size={14} /> Agent instructions</h2>
        <p className="text-xs text-[var(--color-text-muted)] mb-4">
          How your WhatsApp agent talks and what it must and mustn't do: tone, reply length, rules, when to wait for you.
          {activeVersion ? ` In use now: version ${activeVersion}.` : ''}
        </p>

        <label htmlFor="agent_name" className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5">Agent's name <FieldTag required /></label>
        <input {...a11y('agent_name', { required: true, error: fieldErrors.agent_name })} className={`${inputCls} max-w-xs ${invalidCls(fieldErrors.agent_name)}`} value={form.agent_name} maxLength={40}
          onChange={(e) => set('agent_name', e.target.value)} placeholder="e.g. Ian" />
        <FieldError id="agent_name-error">{fieldErrors.agent_name}</FieldError>
        <p className="text-[11px] text-[var(--color-text-muted)] mt-1 mb-4">The name the agent calls itself - not your name. It must match the "You are ..." line in the instructions.</p>

        <label htmlFor="instructions" className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5">Instructions <FieldTag required /></label>
        <textarea {...a11y('instructions', { required: true, error: fieldErrors.instructions })} rows={20} className={`${inputCls} font-[var(--font-mono)] leading-relaxed ${invalidCls(fieldErrors.instructions)}`}
          value={form.instructions} onChange={(e) => set('instructions', e.target.value)} />
        <FieldError id="instructions-error">{fieldErrors.instructions}</FieldError>
        <div className={`text-xs mt-1 ${overLimit ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-muted)]'}`}>
          {form.instructions.length.toLocaleString()} / {limits.instructions.toLocaleString()} characters
        </div>

        <details className="mt-3 text-xs text-[var(--color-text-muted)]">
          <summary className="cursor-pointer select-none">Tips for writing instructions</summary>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            <li>Start a section with <code>## Heading</code> (e.g. <code>## Tone</code>, <code>## Never do this</code>) to keep it easy to read.</li>
            <li><code>{'{{agent_name}}'}</code> and <code>{'{{business_name}}'}</code> are filled in automatically from this page and your Profile.</li>
            <li>A section called <code>## Email & outreach tone</code> is also used by the email and outreach agents (it replaces the old "Voice & tone" field).</li>
            <li>Text inside <code>{'<!-- -->'}</code> is a note for you and is never sent to the AI.</li>
            <li>Facts (prices, hours, policies) are better as Q&A entries or documents than here.</li>
          </ul>
        </details>
      </section>

      <section className={cardCls}>
        <h2 className="text-sm font-semibold mb-1 flex items-center gap-2"><MessageSquare size={14} /> Example replies <FieldTag /></h2>
        <p className="text-xs text-[var(--color-text-muted)] mb-4">
          Show the style you want. The agent copies the style, not the exact words.
        </p>
        <div className="space-y-3">
          {form.examples.length === 0 && <div className="text-xs italic text-[var(--color-text-muted)]">No examples yet.</div>}
          {form.examples.map((ex, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-start p-3 bg-[var(--color-surface-2)] rounded-md">
              <div>
                <label htmlFor={`agent-ex-${i}-customer`} className="block text-[11px] text-[var(--color-text-muted)] mb-1">Customer says</label>
                <textarea rows={2} {...a11y(`agent-ex-${i}-customer`, { error: fieldErrors[`ex-${i}-customer`] })} className={`${inputCls} ${invalidCls(fieldErrors[`ex-${i}-customer`])}`} value={ex.customer} onChange={(e) => setExample(i, 'customer', e.target.value)} placeholder="e.g. Do you deliver?" />
                <FieldError id={`agent-ex-${i}-customer-error`}>{fieldErrors[`ex-${i}-customer`]}</FieldError>
              </div>
              <div>
                <label htmlFor={`agent-ex-${i}-reply`} className="block text-[11px] text-[var(--color-text-muted)] mb-1">{form.agent_name || 'Agent'} replies</label>
                <textarea rows={2} {...a11y(`agent-ex-${i}-reply`, { error: fieldErrors[`ex-${i}-reply`] })} className={`${inputCls} ${invalidCls(fieldErrors[`ex-${i}-reply`])}`} value={ex.reply} onChange={(e) => setExample(i, 'reply', e.target.value)} placeholder="e.g. Yes! We deliver within Accra." />
                <FieldError id={`agent-ex-${i}-reply-error`}>{fieldErrors[`ex-${i}-reply`]}</FieldError>
              </div>
              <button type="button" onClick={() => removeExample(i)} className="mt-5 p-2 text-[var(--color-text-muted)] hover:text-[var(--color-danger)]" title="Remove this example" aria-label={`Remove example ${i + 1}`}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addExample} disabled={form.examples.length >= limits.examples} className={`${btnCls} mt-3`}>
          <Plus size={12} /> Add an example
        </button>
      </section>

      <section className={cardCls}>
        <h2 className="text-sm font-semibold mb-1">When the agent isn't sure</h2>
        <p className="text-xs text-[var(--color-text-muted)]">
          For prices, deals, payments, complaints, or anything the agent doesn't know, it says <b>nothing</b> to the customer - it never says
          "let me check with the team". You get an alert with its suggested answer: reply to the customer yourself, or approve or edit the
          suggestion on the Tasks page. The agent never makes up an answer.
        </p>
      </section>

      <section className={cardCls}>
        <label htmlFor="note" className="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5">What did you change? <FieldTag /> <span className="font-normal">(shown in the history)</span></label>
        <input id="note" className={`${inputCls} mb-3`} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Shorter replies, added delivery example" />

        {(missing.length > 0 || invalid.length > 0) && <div className="mb-3"><FormSummary missing={missing} invalid={invalid} /></div>}
        {error && (
          <div className="flex items-start gap-2 p-3 mb-3 bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 rounded-md text-sm text-[var(--color-danger)] whitespace-pre-wrap">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={save} disabled={saving || (!dirty && source === 'saved')}
            className="px-4 py-2 text-sm bg-[var(--color-accent)] text-black rounded-md hover:opacity-90 disabled:opacity-50 flex items-center gap-2 font-medium">
            <Save size={14} /> {saving ? 'Saving…' : 'Save as new version'}
          </button>
          {dirty && !savedMsg && <span className="text-xs text-amber-500">Unsaved changes</span>}
          {savedMsg && (
            <span className="text-xs text-[var(--color-text-muted)] flex items-center gap-1.5">
              <CheckCircle2 size={12} className="text-emerald-500" /> {savedMsg}
            </span>
          )}
        </div>
      </section>

      <section className={cardCls}>
        <h2 className="text-sm font-semibold mb-1 flex items-center gap-2"><History size={14} /> Version history</h2>
        <p className="text-xs text-[var(--color-text-muted)] mb-4">
          Every save is kept. If a change makes replies worse, roll back to an earlier version.
        </p>
        {versions.length === 0 ? (
          <div className="text-xs italic text-[var(--color-text-muted)]">No saved versions yet.</div>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {versions.map((v, i) => (
              <li key={v.id} className="py-2.5 flex items-center gap-3 flex-wrap text-sm">
                <span className="font-medium w-24">Version {v.version}</span>
                {i === 0 && <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500">In use</span>}
                <span className="text-xs text-[var(--color-text-muted)]">{when(v.created_at)}{v.created_by_email ? ` · ${v.created_by_email}` : ''}</span>
                {v.note && <span className="text-xs text-[var(--color-text-muted)] italic truncate max-w-xs" title={v.note}>“{v.note}”</span>}
                <span className="ml-auto flex gap-2">
                  <button type="button" className={btnCls} disabled={busyVersion === v.id} onClick={() => openPreview(v.id)}>
                    <Eye size={12} /> View
                  </button>
                  {i !== 0 && (
                    <button type="button" className={btnCls} disabled={busyVersion === v.id} onClick={() => rollBack(v)}>
                      <RotateCcw size={12} /> Roll back to this
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {preview && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" onClick={() => setPreview(null)}>
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg max-w-3xl w-full max-h-[85vh] overflow-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Version {preview.version} <span className="text-xs font-normal text-[var(--color-text-muted)]">· {when(preview.created_at)}</span></h3>
              <button type="button" onClick={() => setPreview(null)} className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" aria-label="Close"><X size={16} /></button>
            </div>
            {preview.note && <p className="text-xs italic text-[var(--color-text-muted)] mb-3">“{preview.note}”</p>}
            <div className="text-xs text-[var(--color-text-muted)] mb-1">Agent's name: <span className="text-[var(--color-text)]">{preview.agent_name}</span></div>
            <pre className="text-xs whitespace-pre-wrap bg-[var(--color-surface-2)] p-3 rounded-md mb-3 font-[var(--font-mono)]">{preview.instructions}</pre>
            {(preview.examples || []).length > 0 && (
              <div className="mb-3">
                <div className="text-xs font-medium mb-1">Example replies</div>
                {preview.examples.map((e, i) => (
                  <div key={i} className="text-xs mb-2"><div>Customer: {e.customer}</div><div className="text-[var(--color-text-muted)]">{preview.agent_name}: {e.reply}</div></div>
                ))}
              </div>
            )}
            {preview.version !== versions[0]?.version && (
              <button type="button" className={btnCls} disabled={busyVersion === preview.id} onClick={() => rollBack(preview)}>
                <RotateCcw size={12} /> Roll back to this version
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
