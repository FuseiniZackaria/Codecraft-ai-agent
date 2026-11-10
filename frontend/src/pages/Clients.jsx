import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, AlertCircle, CheckCircle2, QrCode, Unlink, Save, Plus, Trash2, Users, RefreshCw } from 'lucide-react';
import { api } from '../services/api';
import { PageHeader } from '../components/ui/Card';
import { FieldTag, FieldError } from '../components/ui/FormField';

/**
 * Settings -> Clients (app owner only): every client business's WhatsApp
 * number and status, tier, limits and today's numbers. Change a client's
 * settings, link their WhatsApp for them (QR / pairing code), add opted-in
 * contacts for Meta outreach.
 */

const input = 'w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-sm focus:outline-none focus:border-[var(--color-accent)]';
const label = 'block text-[11px] text-[var(--color-text-muted)] mb-1';
const LANGUAGE_LABELS = {
  english: 'English only',
  match: 'English, a little Twi/Pidgin if they use it',
  local: 'Their language (Twi, Pidgin, Ga, Ewe or English)',
};
const fmt = (n) => (n ? `+${n}` : '');

function StatusBadge({ wa }) {
  if (!wa) return <span className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]"><AlertCircle size={12} /> No number linked</span>;
  if (wa.status === 'WORKING') return <span className="flex items-center gap-1 text-xs font-medium text-emerald-600"><CheckCircle2 size={12} /> Connected{wa.kind === 'meta' ? ' (Meta)' : ''}</span>;
  if (wa.needsReconnect || wa.status === 'FAILED') return <span className="flex items-center gap-1 text-xs font-medium text-[var(--color-danger)]"><AlertCircle size={12} /> Disconnected - needs reconnect</span>;
  return <span className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]"><AlertCircle size={12} /> {wa.status === 'SCAN_QR_CODE' ? 'Waiting for QR scan' : 'Not connected'}</span>;
}

export default function Clients() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.getClients());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <PageHeader
        icon={Users}
        title="Clients"
        subtitle="Every business using the WhatsApp agent: its number, tier, limits and today's activity. Only you see this page."
        actions={(
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border border-[var(--color-border)] hover:border-[var(--color-accent)] disabled:opacity-50">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        )}
      />
      {error && <p className="text-sm text-[var(--color-danger)] mb-4">{error}</p>}
      {data && !data.server.multiSession && (
        <div className="mb-4 rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3 text-sm">
          Only one WhatsApp number can be linked right now. Set <code>WAHA_MULTI_SESSION=true</code> on the backend (Render -&gt; Environment) so each client links their own.
        </div>
      )}
      {!data && !error && <p className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]"><Loader2 size={14} className="animate-spin" /> Loading clients…</p>}
      {data && data.clients.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">No businesses yet. Add one on Settings -&gt; Team (new workspace).</p>}
      <div className="space-y-4">
        {data?.clients.map((c) => <ClientCard key={c.id} client={c} server={data.server} onChange={load} />)}
      </div>
    </div>
  );
}

function ClientCard({ client: c, server, onChange }) {
  const [editing, setEditing] = useState(false);
  const [linking, setLinking] = useState(false);
  const s = c.settings;
  const wa = c.whatsapp;
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-sm truncate">{c.name}</h3>
            {c.you && <span className="text-[10px] uppercase tracking-wide border border-[var(--color-border)] rounded px-1.5 py-0.5 text-[var(--color-text-muted)]">You</span>}
            <span className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 ${s.tier === 'reply_only' ? 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)]' : 'bg-[var(--color-accent)]/15 text-[var(--color-text)]'}`}>
              {s.tier === 'reply_only' ? 'Tier 1 - reply only' : 'Outreach'}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">{s.channel === 'meta' ? 'Meta API' : 'WAHA'}</span>
          </div>
          {c.ownerEmail && <p className="text-xs text-[var(--color-text-muted)]">{c.ownerEmail}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusBadge wa={wa} />
            {wa?.phoneNumber && <span className="text-xs text-[var(--color-text-muted)]">{fmt(wa.phoneNumber)}</span>}
            {c.warmup?.warmingUp && <span className="text-xs text-[var(--color-warning)]">Warm-up day {c.warmup.day} of {c.warmup.of}: {c.warmup.limit} outreach a day</span>}
          </div>
          {wa?.lastError && wa.needsReconnect && <p className="text-xs text-[var(--color-danger)] mt-1">{wa.lastError}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {s.channel === 'waha' && !c.you && (
            <button onClick={() => setLinking(true)} disabled={!server.multiSession || !server.wahaConfigured} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border border-[var(--color-border)] hover:border-[var(--color-accent)] disabled:opacity-50">
              <QrCode size={13} /> {wa?.status === 'WORKING' ? 'Linked number' : 'Link WhatsApp'}
            </button>
          )}
          <button onClick={() => setEditing((x) => !x)} className="px-3 py-1.5 rounded-md text-xs border border-[var(--color-border)] hover:border-[var(--color-accent)]">
            {editing ? 'Close' : 'Settings'}
          </button>
        </div>
      </div>

      {c.today && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat label="Messages in today" value={c.today.received} />
          <Stat label="Auto-replies today" value={`${c.today.replies} / ${s.daily_reply_limit}`} warn={c.today.replies >= s.daily_reply_limit} />
          <Stat label="Outreach today" value={`${c.today.outreach} / ${c.warmup?.limit ?? server.dailyOutreachLimit}`} />
        </div>
      )}

      {editing && <SettingsForm client={c} onSaved={onChange} />}
      {s.channel === 'meta' && <OptIns client={c} onAdded={onChange} />}
      {linking && <LinkModal client={c} onClose={() => { setLinking(false); onChange(); }} />}
    </div>
  );
}

function Stat({ label: l, value, warn = false }) {
  return (
    <div className="rounded-md bg-[var(--color-surface-2)] py-2">
      <div className={`text-sm font-semibold ${warn ? 'text-[var(--color-warning)]' : ''}`}>{value}</div>
      <div className="text-[10px] text-[var(--color-text-muted)]">{l}</div>
    </div>
  );
}

function SettingsForm({ client: c, onSaved }) {
  const s = c.settings;
  const [form, setForm] = useState({
    tier: s.tier,
    channel: s.channel,
    auto_reply: s.auto_reply,
    alert_number: s.alert_number || '',
    place: s.place || '',
    language: s.language,
    daily_reply_limit: s.daily_reply_limit,
    warmup_days: s.warmup_days,
    meta_templates: s.meta_templates || [],
  });
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [k]: null })); };
  const setTemplate = (i, k, v) => set('meta_templates', form.meta_templates.map((t, j) => (j === i ? { ...t, [k]: v } : t)));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await api.saveClientSettings(c.id, {
        ...form,
        daily_reply_limit: form.daily_reply_limit === '' ? null : Number(form.daily_reply_limit),
        warmup_days: Number(form.warmup_days),
        meta_templates: form.meta_templates.map((t) => ({ ...t, params: Number(t.params || 0) })),
      });
      setNotice({ ok: true, text: 'Saved. It applies from the next message.' });
      onSaved();
    } catch (err) {
      setErrors(err.body?.fieldErrors || {});
      setNotice({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} noValidate className="mt-4 border-t border-[var(--color-border)] pt-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className={label} htmlFor={`tier-${c.id}`}>Tier <FieldTag required /></label>
          <select id={`tier-${c.id}`} value={form.tier} onChange={(e) => set('tier', e.target.value)} className={input}>
            <option value="reply_only">Tier 1 - reply only (no outreach)</option>
            <option value="outreach">Outreach</option>
          </select>
          <FieldError>{errors.tier}</FieldError>
        </div>
        <div>
          <label className={label} htmlFor={`channel-${c.id}`}>WhatsApp connection <FieldTag required /></label>
          <select id={`channel-${c.id}`} value={form.channel} onChange={(e) => set('channel', e.target.value)} className={input}>
            <option value="waha">WAHA - linked phone (QR code)</option>
            <option value="meta">Meta - official Cloud API</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor={`auto-${c.id}`}>Automatic replies <FieldTag required /></label>
          <select id={`auto-${c.id}`} value={String(form.auto_reply)} onChange={(e) => set('auto_reply', e.target.value === 'true')} className={input}>
            <option value="true">On - safe answers go out by themselves</option>
            <option value="false">Off - every reply waits for approval</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor={`alert-${c.id}`}>Alert number <FieldTag /></label>
          <input id={`alert-${c.id}`} value={form.alert_number} onChange={(e) => set('alert_number', e.target.value)} placeholder="Their own phone, e.g. 024 123 4567" className={input} />
          <FieldError>{errors.alert_number}</FieldError>
        </div>
        <div>
          <label className={label} htmlFor={`place-${c.id}`}>Town or city <FieldTag /></label>
          <input id={`place-${c.id}`} value={form.place} onChange={(e) => set('place', e.target.value)} placeholder="e.g. Kumasi" className={input} />
          <FieldError>{errors.place}</FieldError>
        </div>
        <div>
          <label className={label} htmlFor={`lang-${c.id}`}>Reply language <FieldTag required /></label>
          <select id={`lang-${c.id}`} value={form.language} onChange={(e) => set('language', e.target.value)} className={input}>
            {Object.entries(LANGUAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor={`limit-${c.id}`}>Auto-replies per day <FieldTag /></label>
          <input id={`limit-${c.id}`} type="number" min="1" max="1000" value={form.daily_reply_limit ?? ''} onChange={(e) => set('daily_reply_limit', e.target.value)} className={input} />
          <FieldError>{errors.daily_reply_limit}</FieldError>
        </div>
        <div>
          <label className={label} htmlFor={`warm-${c.id}`}>Warm-up days for a new number <FieldTag required /></label>
          <input id={`warm-${c.id}`} type="number" min="0" max="60" value={form.warmup_days} onChange={(e) => set('warmup_days', e.target.value)} className={input} />
          <FieldError>{errors.warmup_days}</FieldError>
        </div>
      </div>

      {form.channel === 'meta' && (
        <div>
          <div className="flex items-center justify-between">
            <span className={label}>Approved Meta templates <FieldTag /></span>
            <button type="button" onClick={() => set('meta_templates', [...form.meta_templates, { name: '', language: 'en', params: 0, body: '' }])} className="flex items-center gap-1 text-xs text-[var(--color-accent)]">
              <Plus size={12} /> Add template
            </button>
          </div>
          <p className="text-[11px] text-[var(--color-text-muted)] mb-2">Copy each one exactly as it shows in Meta's WhatsApp Manager once it's approved. Variables are the {'{{1}}'}, {'{{2}}'}… in it.</p>
          {form.meta_templates.map((t, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 mb-2">
              <input aria-label="Template name" value={t.name} onChange={(e) => setTemplate(i, 'name', e.target.value)} placeholder="name, e.g. new_stock" className={`${input} col-span-4`} />
              <input aria-label="Language code" value={t.language} onChange={(e) => setTemplate(i, 'language', e.target.value)} placeholder="en" className={`${input} col-span-2`} />
              <input aria-label="Number of variables" type="number" min="0" max="10" value={t.params} onChange={(e) => setTemplate(i, 'params', e.target.value)} className={`${input} col-span-2`} />
              <input aria-label="Template text" value={t.body} onChange={(e) => setTemplate(i, 'body', e.target.value)} placeholder="Text (for the Inbox), e.g. Hi {{1}}, new stock is in!" className={`${input} col-span-3`} />
              <button type="button" aria-label="Remove template" onClick={() => set('meta_templates', form.meta_templates.filter((_, j) => j !== i))} className="col-span-1 text-[var(--color-text-muted)] hover:text-[var(--color-danger)]"><Trash2 size={14} /></button>
            </div>
          ))}
          <FieldError>{errors.meta_templates}</FieldError>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-[var(--color-accent)] text-black disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
        </button>
        {notice && <span className={`text-xs ${notice.ok ? 'text-emerald-600' : 'text-[var(--color-danger)]'}`}>{notice.text}</span>}
      </div>
    </form>
  );
}

function OptIns({ client: c, onAdded }) {
  const [open, setOpen] = useState(false);
  const [numbers, setNumbers] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  async function add(e) {
    e.preventDefault();
    setNotice(null);
    if (!numbers.trim()) return setNotice({ ok: false, text: 'Paste at least one phone number.' });
    if (!confirm) return setNotice({ ok: false, text: 'Tick the box to confirm these people agreed to get messages.' });
    setBusy(true);
    try {
      const r = await api.addClientOptIns(c.id, { numbers, confirm: true });
      setNotice({ ok: true, text: `Added ${r.added}.${r.invalidCount ? ` ${r.invalidCount} didn't look like phone numbers.` : ''} ${r.total} opted in now.` });
      setNumbers('');
      setConfirm(false);
      onAdded();
    } catch (err) {
      setNotice({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 text-xs">
      <button type="button" onClick={() => setOpen((x) => !x)} className="text-[var(--color-accent)] hover:underline">
        Opt-ins: {c.optIns} contact{c.optIns === 1 ? '' : 's'} agreed to get messages {open ? '(close)' : '- add more'}
      </button>
      {open && (
        <form onSubmit={add} noValidate className="mt-2 space-y-2">
          <label className={label} htmlFor={`optin-${c.id}`}>Phone numbers, one per line <FieldTag required /></label>
          <textarea id={`optin-${c.id}`} rows={4} value={numbers} onChange={(e) => setNumbers(e.target.value)} className={input} placeholder={'0241234567\n+233201234567'} />
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5" />
            <span>These people agreed to get WhatsApp messages from {c.name} (for example a sign-up form or at the counter). Meta can block the number if they didn't.</span>
          </label>
          <button type="submit" disabled={busy} className="px-3 py-1.5 rounded-md font-medium bg-[var(--color-accent)] text-black disabled:opacity-50">
            {busy ? <Loader2 size={13} className="animate-spin" /> : 'Add opt-ins'}
          </button>
          {notice && <p className={notice.ok ? 'text-emerald-600' : 'text-[var(--color-danger)]'}>{notice.text}</p>}
        </form>
      )}
    </div>
  );
}

/** Link a client's WhatsApp from your screen: QR code (refreshing) or a pairing code. */
function LinkModal({ client: c, onClose }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState(null);
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const s = await api.getClientWhatsapp(c.id);
      setState(s);
      return s;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, [c.id]);

  useEffect(() => {
    load();
    timer.current = setInterval(load, 4000);
    return () => clearInterval(timer.current);
  }, [load]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function run(fn) {
    setBusy(true);
    setError(null);
    try { await fn(); await load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  const status = state?.status;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Link WhatsApp for ${c.name}`}>
      <div className="w-full max-w-sm rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold">Link WhatsApp for {c.name}</h3>
        {!state && !error && <p className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]"><Loader2 size={14} className="animate-spin" /> Checking…</p>}
        {status === 'WORKING' && (
          <>
            <p className="text-sm text-emerald-600 flex items-center gap-1"><CheckCircle2 size={14} /> Linked {fmt(state.phoneNumber)}{state.pushName ? ` (${state.pushName})` : ''}</p>
            <button disabled={busy} onClick={() => window.confirm(`Disconnect ${c.name}'s WhatsApp? Their agent stops replying.`) && run(() => api.disconnectClientWhatsapp(c.id))} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border border-[var(--color-border)] hover:text-[var(--color-danger)]">
              <Unlink size={13} /> Disconnect
            </button>
          </>
        )}
        {status === 'SCAN_QR_CODE' && (
          <>
            <p className="text-xs text-[var(--color-text-muted)]">On the client's phone: WhatsApp -&gt; Settings -&gt; Linked devices -&gt; Link a device, then scan this.</p>
            {state.qr ? <img src={state.qr} alt="WhatsApp QR code" className="w-56 h-56 mx-auto bg-white p-2 rounded" /> : <p className="text-sm">Waiting for the QR code…</p>}
            <div>
              <label className={label} htmlFor="client-pair-phone">Or link with a code - their WhatsApp number <FieldTag /></label>
              <div className="flex gap-2">
                <input id="client-pair-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="233201234567" className={input} />
                <button disabled={busy || !phone.trim()} onClick={() => run(async () => setCode((await api.clientPairingCode(c.id, phone)).code))} className="px-3 py-1.5 rounded-md text-xs border border-[var(--color-border)] disabled:opacity-50">Get code</button>
              </div>
              {code && <p className="mt-2 text-lg font-mono tracking-widest text-center">{code}</p>}
            </div>
          </>
        )}
        {status && !['WORKING', 'SCAN_QR_CODE'].includes(status) && (
          <>
            <p className="text-sm text-[var(--color-text-muted)]">{status === 'UNREACHABLE' ? `The WhatsApp server isn't answering: ${state.error}` : 'Not linked yet.'}</p>
            <button disabled={busy} onClick={() => run(() => api.startClientWhatsapp(c.id))} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-[var(--color-accent)] text-black disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <QrCode size={14} />} Show QR code
            </button>
          </>
        )}
        {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
        <div className="text-right"><button onClick={onClose} className="text-sm text-[var(--color-text-muted)]">Close</button></div>
      </div>
    </div>
  );
}
