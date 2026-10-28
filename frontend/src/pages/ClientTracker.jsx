import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Contact, RefreshCw, Send, Upload, Inbox, CalendarClock, Settings as SettingsIcon } from 'lucide-react';
import { api } from '../services/api';

const card = 'bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-4';
const input = 'w-full text-sm px-3 py-2 rounded-md bg-[var(--color-bg)] border border-[var(--color-border)]';
const btn = 'inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-[var(--color-accent)] text-black hover:brightness-110 disabled:opacity-50';
const btnGhost = 'inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50';

// "Name, email, company, high-value" per line; a header line is skipped.
function parseLeads(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => l.split(/\t|,/).map((c) => c.trim()))
    .filter((c) => c.some((v) => v.includes('@')))
    .map((c) => {
      const email = c.find((v) => v.includes('@'));
      const rest = c.filter((v) => v !== email);
      return { name: rest[0] || '', email, company: rest[1] || '', highValue: /^(y|yes|true|high)/i.test(rest[2] || '') };
    });
}

function Summary({ result }) {
  if (!result) return null;
  if (result.error) return <div className="text-xs text-[var(--color-danger)] mt-2">{result.error}</div>;
  const parts = [];
  if (result.added != null) parts.push(`${result.added} added`);
  if (result.skipped?.length) parts.push(`${result.skipped.length} skipped (${[...new Set(result.skipped.map((s) => s.reason))].join(', ')})`);
  if (result.sent != null) parts.push(`${result.sent} sent`);
  if (result.pendingApproval) parts.push(`${result.pendingApproval} waiting for your approval on the Tasks page`);
  if (result.blocked) parts.push(`${result.blocked} blocked (see Activity Log)`);
  if (result.handled) parts.push(result.handled.length ? result.handled.map((h) => `${h.email}: ${h.outcome}`).join(', ') : 'no new replies');
  return <div className="text-xs text-[var(--color-text-muted)] mt-2">{parts.join(' · ') || 'Done.'}</div>;
}

export default function ClientTracker() {
  const [status, setStatus] = useState(null);
  const [activity, setActivity] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [results, setResults] = useState({});
  const [settings, setSettings] = useState({ daily_cap: 30, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, work_start: '09:00', work_end: '17:00', meeting_minutes: 30, follow_up_time: '09:00' });
  const [leadsText, setLeadsText] = useState('');
  const [outreach, setOutreach] = useState({ subject: '', body: 'Hi {{first_name}},\n\n', limit: 10 });

  const load = useCallback(async () => {
    try {
      const s = await api.trackerStatus();
      setStatus(s);
      if (s.settings?.enabled) {
        setSettings((cur) => ({ ...cur, ...pick(s.settings) }));
        setActivity(await api.trackerActivity().catch(() => []));
      }
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function run(key, fn) {
    setBusy(key);
    try {
      const r = await fn();
      setResults((cur) => ({ ...cur, [key]: r }));
      await load();
    } catch (err) {
      setResults((cur) => ({ ...cur, [key]: { error: err.message } }));
    } finally {
      setBusy('');
    }
  }

  const enabled = status?.settings?.enabled;
  const parsed = parseLeads(leadsText);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Contact size={18} />
          <h1 className="text-lg font-semibold">Client Tracker</h1>
        </div>
        <button type="button" className={btnGhost} onClick={load}><RefreshCw size={12} /> Refresh</button>
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">
        Outreach, replies, follow-ups and bookings, tracked in your Google Sheet. Uses your Gmail, Google Sheets and Google Calendar
        from <Link to="/connections" className="underline">Connections</Link>. The agent only reads threads labelled
        "CodeCraft Outreach" from people in your sheet.
      </p>
      {error && <div className={`${card} text-xs text-[var(--color-danger)]`}>{error}</div>}

      {enabled && status?.leads && (
        <div className={card}>
          <div className="text-sm font-medium mb-2">Leads ({status.leads.total}) · {status.sentToday ?? 0}/{status.settings.daily_cap} emails today</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(status.leads.byStage).map(([stage, n]) => (
              <span key={stage} className="text-xs px-2 py-1 rounded-md border border-[var(--color-border)]">{stage}: {n}</span>
            ))}
          </div>
          {status.error && <div className="text-xs text-[var(--color-danger)] mt-2">{status.error}</div>}
        </div>
      )}

      <div className={card}>
        <div className="flex items-center gap-2 text-sm font-medium mb-3"><SettingsIcon size={14} /> {enabled ? 'Settings' : 'Set up'}</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Field label="Daily email cap"><input className={input} type="number" min="1" max="500" value={settings.daily_cap} onChange={(e) => setSettings({ ...settings, daily_cap: e.target.value })} /></Field>
          <Field label="Timezone"><input className={input} value={settings.timezone} onChange={(e) => setSettings({ ...settings, timezone: e.target.value })} /></Field>
          <Field label="Meeting length (min)">
            <select className={input} value={settings.meeting_minutes} onChange={(e) => setSettings({ ...settings, meeting_minutes: Number(e.target.value) })}>
              {[15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Working hours from"><input className={input} type="time" value={settings.work_start} onChange={(e) => setSettings({ ...settings, work_start: e.target.value })} /></Field>
          <Field label="Working hours to"><input className={input} type="time" value={settings.work_end} onChange={(e) => setSettings({ ...settings, work_end: e.target.value })} /></Field>
          <Field label="Daily follow-up time"><input className={input} type="time" value={settings.follow_up_time} onChange={(e) => setSettings({ ...settings, follow_up_time: e.target.value })} /></Field>
        </div>
        <div className="flex gap-2 mt-3">
          {enabled ? (
            <>
              <button type="button" className={btn} disabled={!!busy} onClick={() => run('settings', () => api.trackerSettings(settings))}>Save settings</button>
              <button type="button" className={btnGhost} disabled={!!busy} onClick={() => run('settings', () => api.trackerSettings({ enabled: false }))}>Turn off automation</button>
            </>
          ) : (
            <button type="button" className={btn} disabled={!!busy} onClick={() => run('settings', () => api.trackerSetup(settings))}>
              {busy === 'settings' ? 'Setting up…' : status?.settings?.label_id ? 'Turn on' : 'Set up tracker'}
            </button>
          )}
        </div>
        {!enabled && <div className="text-xs text-[var(--color-text-muted)] mt-2">Adds the Client Tracker, Activity Log and Do Not Contact tabs to your connected sheet and creates the Gmail label.</div>}
        <Summary result={results.settings?.error ? results.settings : null} />
      </div>

      {enabled && (
        <>
          <div className={card}>
            <div className="flex items-center gap-2 text-sm font-medium mb-2"><Upload size={14} /> Import leads</div>
            <textarea className={`${input} font-mono text-xs`} rows={5} placeholder={'Name, email, company, high-value\nAma Owusu, ama@example.com, Owusu Ltd, yes'} value={leadsText} onChange={(e) => setLeadsText(e.target.value)} />
            <div className="flex items-center gap-2 mt-2">
              <button type="button" className={btn} disabled={!!busy || !parsed.length} onClick={() => run('import', () => api.trackerImport(parsed))}>Import {parsed.length || ''} lead{parsed.length === 1 ? '' : 's'}</button>
              <span className="text-xs text-[var(--color-text-muted)]">Addresses on Do Not Contact are never re-added.</span>
            </div>
            <Summary result={results.import} />
          </div>

          <div className={card}>
            <div className="flex items-center gap-2 text-sm font-medium mb-2"><Send size={14} /> Send outreach to new leads</div>
            <div className="space-y-2">
              <input className={input} placeholder="Subject - e.g. Quick idea for {{company}}" value={outreach.subject} onChange={(e) => setOutreach({ ...outreach, subject: e.target.value })} />
              <textarea className={input} rows={6} value={outreach.body} onChange={(e) => setOutreach({ ...outreach, body: e.target.value })} />
              <div className="text-xs text-[var(--color-text-muted)]">
                Use {'{{first_name}}'}, {'{{name}}'}, {'{{company}}'}. The "reply stop to opt out" line is added automatically. High-value leads wait for your approval on the Tasks page.
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs">Send to up to</span>
                <input className={`${input} w-20`} type="number" min="1" max="100" value={outreach.limit} onChange={(e) => setOutreach({ ...outreach, limit: e.target.value })} />
                <button type="button" className={btn} disabled={!!busy || !outreach.subject.trim()} onClick={() => run('outreach', () => api.trackerOutreach(outreach))}>
                  {busy === 'outreach' ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
            <Summary result={results.outreach} />
          </div>

          <div className={card}>
            <div className="text-sm font-medium mb-2">Run now</div>
            <div className="text-xs text-[var(--color-text-muted)] mb-2">These also run automatically: replies every 15 minutes, follow-ups daily at {status.settings.follow_up_time}.</div>
            <div className="flex gap-2">
              <button type="button" className={btnGhost} disabled={!!busy} onClick={() => run('replies', api.trackerCheckReplies)}><Inbox size={12} /> {busy === 'replies' ? 'Checking…' : 'Check replies'}</button>
              <button type="button" className={btnGhost} disabled={!!busy} onClick={() => run('followups', api.trackerFollowUps)}><CalendarClock size={12} /> {busy === 'followups' ? 'Running…' : 'Send due follow-ups'}</button>
            </div>
            <Summary result={results.replies} />
            <Summary result={results.followups} />
          </div>

          <div className={card}>
            <div className="text-sm font-medium mb-2">Recent activity</div>
            {activity.length === 0 ? (
              <div className="text-xs text-[var(--color-text-muted)]">Nothing yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-[var(--color-text-muted)] text-left">
                    <tr><th className="py-1 pr-3">When</th><th className="pr-3">Lead</th><th className="pr-3">Action</th><th className="pr-3">Result</th><th>Details</th></tr>
                  </thead>
                  <tbody>
                    {activity.map((a, i) => (
                      <tr key={i} className="border-t border-[var(--color-border)]">
                        <td className="py-1 pr-3 whitespace-nowrap">{a.at ? new Date(a.at).toLocaleString() : ''}</td>
                        <td className="pr-3">{a.email}</td>
                        <td className="pr-3">{a.action}</td>
                        <td className="pr-3">{a.result}</td>
                        <td className="text-[var(--color-text-muted)]">{a.details}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function pick(s) {
  const out = {};
  for (const k of ['daily_cap', 'timezone', 'work_start', 'work_end', 'meeting_minutes', 'follow_up_time']) if (s[k] != null) out[k] = s[k];
  return out;
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs text-[var(--color-text-muted)] mb-1">{label}</span>
      {children}
    </label>
  );
}
