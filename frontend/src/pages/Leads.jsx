import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, RefreshCw, Download, Search, Settings as SettingsIcon, ChevronDown, ChevronRight, MessageCircle, FileSpreadsheet } from 'lucide-react';
import { api } from '../services/api';
import EmptyState from '../components/EmptyState';
import { FieldTag, FieldError, invalidCls, a11y } from '../components/ui/FormField';

const card = 'bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg';
const input = 'text-sm px-3 py-2 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)]';
const btn = 'inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-black hover:brightness-110 disabled:opacity-50';
const btnGhost = 'inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50';

const STATUS_LABELS = { new: 'New', interested: 'Interested', quote_sent: 'Quote sent', won: 'Won', lost: 'Lost', not_interested: 'Not interested' };
const STATUS_COLORS = {
  new: 'bg-sky-500/15 text-sky-300', interested: 'bg-amber-500/15 text-amber-300', quote_sent: 'bg-violet-500/15 text-violet-300',
  won: 'bg-emerald-500/15 text-emerald-300', lost: 'bg-zinc-500/20 text-zinc-300', not_interested: 'bg-rose-500/15 text-rose-300',
};
const NEED_LABELS = { website: 'Website', ecommerce: 'E-commerce', design: 'Design', ai_assistant: 'AI assistant', seo: 'SEO', other: 'Other' };

function when(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return `Today ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString();
}

function toCsv(rows) {
  const cols = [
    ['Source', (l) => (l.source === 'whatsapp' ? 'WhatsApp' : 'Scraped')], ['Name', (l) => l.name], ['Number', (l) => l.number], ['Email', (l) => l.email],
    ['Need', (l) => NEED_LABELS[l.need] || l.need], ['Business', (l) => l.businessType], ['Budget', (l) => l.budget], ['Timeline', (l) => l.timeline],
    ['Location', (l) => l.location], ['Status', (l) => STATUS_LABELS[l.status] || l.status], ['Last message', (l) => l.lastMessageAt],
    ['Follow-ups sent', (l) => l.followUpsSent], ['Summary', (l) => l.summary], ['Notes', (l) => l.notes],
  ];
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    // Quote everything; a leading = + - @ could run as a formula in Excel.
    return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  };
  return [cols.map(([h]) => cell(h)).join(','), ...rows.map((l) => cols.map(([, f]) => cell(f(l))).join(','))].join('\r\n');
}

function SettingsPanel({ settings, onSaved }) {
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [errors, setErrors] = useState({});
  useEffect(() => setForm(settings), [settings]);
  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (k === 'first_followup_days' || k === 'second_followup_days') setErrors({});
  };

  async function save() {
    setMsg('');
    // Both delays are required whole numbers; the second must come after the first.
    const whole = (v, min, max) => String(v ?? '').trim() !== '' && Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max;
    const problems = {};
    if (String(form.first_followup_days ?? '').trim() === '') problems.first = 'First follow-up is required.';
    else if (!whole(form.first_followup_days, 1, 30)) problems.first = 'Use a whole number of days from 1 to 30.';
    if (String(form.second_followup_days ?? '').trim() === '') problems.second = 'Second follow-up is required.';
    else if (!whole(form.second_followup_days, 2, 60)) problems.second = 'Use a whole number of days from 2 to 60.';
    else if (!problems.first && Number(form.second_followup_days) <= Number(form.first_followup_days)) problems.second = 'The second follow-up must come after the first.';
    setErrors(problems);
    if (problems.first || problems.second) {
      document.getElementById(problems.first ? 'lead-first-days' : 'lead-second-days')?.focus();
      return;
    }
    setBusy(true);
    try {
      const r = await api.saveLeadSettings({
        ...form,
        first_followup_days: Number(form.first_followup_days), second_followup_days: Number(form.second_followup_days), summary_hour: Number(form.summary_hour),
      });
      onSaved(r.settings);
      setMsg('Saved.');
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (k, label, hint) => (
    <label className="flex items-start gap-2 text-sm cursor-pointer">
      <input type="checkbox" className="mt-1" checked={!!form[k]} onChange={(e) => set(k, e.target.checked)} />
      <span>{label}{hint && <span className="block text-xs text-[var(--color-text-muted)]">{hint}</span>}</span>
    </label>
  );

  return (
    <div className={`${card} p-4 space-y-3`}>
      <div className="font-medium text-sm">Follow-ups and daily summary</div>
      {toggle('followups_enabled', 'Send follow-ups to WhatsApp leads who go quiet', 'Only people who messaged you first - never scraped leads, never cold messages. At most 2 per person, 8am-7pm, never on Sundays.')}
      {toggle('ask_before_followup', 'Ask me before sending follow-ups', 'Each follow-up waits on your Tasks page until you approve it. Follow-ups that mention a price always wait.')}
      <div className="flex flex-wrap gap-4 text-sm">
        <div>
          <label htmlFor="lead-first-days" className="flex items-center gap-2">First follow-up after
            <input {...a11y('lead-first-days', { required: true, error: errors.first })} type="number" min="1" max="30" step="1" inputMode="numeric"
              className={`${input} w-20 ${invalidCls(errors.first)}`} value={form.first_followup_days ?? ''} onChange={(e) => set('first_followup_days', e.target.value)} /> days <FieldTag required />
          </label>
          <FieldError id="lead-first-days-error">{errors.first}</FieldError>
        </div>
        <div>
          <label htmlFor="lead-second-days" className="flex items-center gap-2">Second (last) after
            <input {...a11y('lead-second-days', { required: true, error: errors.second })} type="number" min="2" max="60" step="1" inputMode="numeric"
              className={`${input} w-20 ${invalidCls(errors.second)}`} value={form.second_followup_days ?? ''} onChange={(e) => set('second_followup_days', e.target.value)} /> days <FieldTag required />
          </label>
          <FieldError id="lead-second-days-error">{errors.second}</FieldError>
        </div>
      </div>
      {toggle('daily_summary', 'Send me a daily summary', 'New leads, replies and follow-ups - on WhatsApp (or Telegram/email). Skipped on days with nothing new.')}
      <label className="flex items-center gap-2 text-sm">Summary time
        <select className={input} value={form.summary_hour ?? 19} onChange={(e) => set('summary_hour', e.target.value)}>
          {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>)}
        </select>
        <span className="text-xs text-[var(--color-text-muted)]">Ghana time</span>
      </label>
      <div className="flex items-center gap-3">
        <button type="button" className={btn} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
        {msg && <span className="text-xs text-[var(--color-text-muted)]">{msg}</span>}
      </div>
    </div>
  );
}

function LeadDetails({ lead, onSave }) {
  const [notes, setNotes] = useState(lead.notes || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  async function save() {
    setBusy(true);
    setMsg('');
    try { await onSave({ notes }); setMsg('Saved.'); } catch (err) { setMsg(err.message); } finally { setBusy(false); }
  }
  const facts = [
    ['Business', lead.businessType], ['Budget', lead.budget], ['Timeline', lead.timeline], ['Location', lead.location], ['Email', lead.email],
    ['Follow-ups sent', lead.source === 'whatsapp' ? `${lead.followUpsSent} of 2` : null], ['Status set by', lead.statusSetBy === 'owner' ? 'you' : lead.statusSetBy === 'ian' ? 'Ian' : null],
    ['Sheet source', lead.sheetSource],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');
  return (
    <div className="p-4 grid md:grid-cols-2 gap-4 bg-[var(--color-surface-2)]">
      <div className="space-y-2 text-sm">
        {lead.summary && <p className="text-[var(--color-text)]">{lead.summary}</p>}
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {facts.map(([k, v]) => [<dt key={`${k}t`} className="text-[var(--color-text-muted)]">{k}</dt>, <dd key={`${k}d`}>{v}</dd>])}
        </dl>
        {lead.source === 'whatsapp' && (
          <Link to="/work/inbox" className="inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline"><MessageCircle size={13} /> Open the chat in Inbox</Link>
        )}
      </div>
      <div className="space-y-2">
        <label className="text-xs text-[var(--color-text-muted)]">Your notes (only you see these)</label>
        <textarea className={`${input} w-full h-24`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Called on Monday, wants a quote by Friday" />
        <div className="flex items-center gap-3">
          <button type="button" className={btn} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save notes'}</button>
          {msg && <span className="text-xs text-[var(--color-text-muted)]">{msg}</span>}
        </div>
      </div>
    </div>
  );
}

export default function Leads() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [need, setNeed] = useState('');
  const [source, setSource] = useState('');
  const [open, setOpen] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.getLeads());
      setError('');
      setMigrationMissing(false);
    } catch (err) {
      setError(err.message);
      setMigrationMissing(/0008_leads|migration/i.test(err.message));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const leads = useMemo(() => data?.leads || [], [data]);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return leads.filter((l) => (!status || l.status === status) && (!need || l.need === need) && (!source || l.source === source)
      && (!term || [l.name, l.number, l.email, l.summary, l.notes, l.businessType, l.location].some((v) => String(v || '').toLowerCase().includes(term))));
  }, [leads, q, status, need, source]);

  async function update(lead, patch) {
    const r = await api.updateLead(lead.id, patch);
    setData((d) => ({ ...d, leads: d.leads.map((l) => (l.id === lead.id
      ? { ...l, ...(patch.status ? { status: r.lead.status, statusSetBy: 'owner' } : {}), ...(patch.notes !== undefined ? { notes: r.lead.notes } : {}) }
      : l)) }));
  }

  function exportCsv() {
    const blob = new Blob([`﻿${toCsv(shown)}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const counts = useMemo(() => Object.fromEntries(Object.keys(STATUS_LABELS).map((s) => [s, leads.filter((l) => l.status === s).length])), [leads]);

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div data-tour="leads-header">
          <h1 className="text-lg font-semibold flex items-center gap-2"><Users size={18} /> Leads</h1>
          <p className="text-xs text-[var(--color-text-muted)]">Everyone who messages you on WhatsApp, plus the leads in your Google Sheet. Ian fills in the details as he chats.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={btnGhost} onClick={() => setShowSettings((s) => !s)}><SettingsIcon size={14} /> Follow-up settings</button>
          <button type="button" className={btnGhost} onClick={exportCsv} disabled={!shown.length}><Download size={14} /> Export CSV</button>
          <button type="button" className={btnGhost} onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh</button>
        </div>
      </div>

      {error && (
        <div className={`${card} p-4 text-sm`}>
          {migrationMissing ? (
            <>
              <div className="font-medium">One setup step left</div>
              <p className="text-[var(--color-text-muted)] mt-1">The leads tables aren't in your database yet. In Supabase, open SQL Editor, paste the file <code>backend/database/migrations/0008_leads.sql</code> and click Run. Then refresh this page.</p>
            </>
          ) : <span className="text-[var(--color-danger)]">{error}</span>}
        </div>
      )}

      {showSettings && data?.settings && (
        <SettingsPanel settings={data.settings} onSaved={(s) => setData((d) => ({ ...d, settings: s }))} />
      )}

      {data && (
        <>
          <div className="flex flex-wrap gap-2">
            {Object.entries(STATUS_LABELS).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setStatus((s) => (s === k ? '' : k))}
                className={`text-xs px-2.5 py-1 rounded-full ${STATUS_COLORS[k]} ${status === k ? 'ring-1 ring-[var(--color-accent)]' : ''}`}>
                {label} · {counts[k] || 0}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input className={`${input} w-full pl-8`} placeholder="Search name, number, notes…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select className={input} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className={input} value={need} onChange={(e) => setNeed(e.target.value)}>
              <option value="">All needs</option>
              {Object.entries(NEED_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className={input} value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">All sources</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="scraped">Scraped</option>
            </select>
          </div>

          {data.sheet?.error && (
            <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1"><FileSpreadsheet size={13} /> Couldn't read your Google Sheet: {data.sheet.error}</div>
          )}

          <div className={`${card} overflow-x-auto`}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--color-text-muted)] border-b border-[var(--color-border)]">
                  <th className="p-3 w-6" />
                  <th className="p-3">Name</th>
                  <th className="p-3">Number</th>
                  <th className="p-3">Need</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Last message</th>
                  <th className="p-3">Summary</th>
                  <th className="p-3">Source</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <LeadRow key={l.id} lead={l} open={open === l.id} onToggle={() => setOpen((o) => (o === l.id ? null : l.id))} onUpdate={(patch) => update(l, patch)} />
                ))}
                {!shown.length && (
                  <tr><td colSpan={8} className="p-0">
                    {leads.length ? (
                      <div className="p-6 text-center text-[var(--color-text-muted)]">No leads match these filters.</div>
                    ) : (
                      <EmptyState
                        icon={Users}
                        title="No leads yet"
                        text="They'll appear here when customers message you on WhatsApp. Ian fills in their name, what they need and a short summary as he chats."
                        action={{ label: 'Connect WhatsApp', to: '/toolbox/connections' }}
                      />
                    )}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-[var(--color-text-muted)]">Showing {shown.length} of {leads.length}. Scraped leads are never messaged automatically; changing them here doesn't change your Google Sheet.</div>
        </>
      )}
    </div>
  );
}

function LeadRow({ lead, open, onToggle, onUpdate }) {
  const [err, setErr] = useState('');
  async function changeStatus(e) {
    setErr('');
    try { await onUpdate({ status: e.target.value }); } catch (x) { setErr(x.message); }
  }
  return (
    <>
      <tr className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-2)] cursor-pointer" onClick={onToggle}>
        <td className="p-3 text-[var(--color-text-muted)]">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
        <td className="p-3 font-medium">{lead.name || <span className="text-[var(--color-text-muted)]">Unknown</span>}</td>
        <td className="p-3 whitespace-nowrap">{lead.number ? `+${String(lead.number).replace(/^\+/, '')}` : (lead.email || '-')}</td>
        <td className="p-3">{NEED_LABELS[lead.need] || '-'}</td>
        <td className="p-3" onClick={(e) => e.stopPropagation()}>
          <select value={lead.status} onChange={changeStatus} className={`text-xs px-2 py-1 rounded-md border-0 ${STATUS_COLORS[lead.status] || ''}`}>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k} className="bg-[var(--color-surface)] text-[var(--color-text)]">{v}</option>)}
          </select>
          {err && <div className="text-xs text-[var(--color-danger)] mt-1">{err}</div>}
        </td>
        <td className="p-3 whitespace-nowrap text-xs text-[var(--color-text-muted)]">{when(lead.lastMessageAt || lead.createdAt)}</td>
        <td className="p-3 text-xs text-[var(--color-text-muted)] max-w-xs truncate" title={lead.summary || ''}>{lead.summary || '-'}</td>
        <td className="p-3">
          <span className={`text-xs px-2 py-0.5 rounded-full ${lead.source === 'whatsapp' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-500/20 text-zinc-300'}`}>
            {lead.source === 'whatsapp' ? 'WhatsApp' : 'Scraped'}
          </span>
        </td>
      </tr>
      {open && <tr><td colSpan={8} className="p-0"><LeadDetails lead={lead} onSave={onUpdate} /></td></tr>}
    </>
  );
}
