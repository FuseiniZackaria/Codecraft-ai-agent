import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { api } from '../../services/api';
import { FieldTag, FieldError, a11y, invalidCls } from '../ui/FormField';

/**
 * Settings -> WhatsApp: this business's own WhatsApp agent settings - where
 * its alerts go, its town (for "good morning"), the reply language, and
 * automatic replies on/off. The tier and limits are shown; the app owner sets them.
 */

const LANGUAGES = [
  { value: 'english', label: 'English only', hint: 'Always replies in English, even if the customer writes in Twi or Pidgin.' },
  { value: 'match', label: 'English, a little Twi/Pidgin if they use it', hint: 'Mostly English; mixes in a little of the customer\'s language when they do.' },
  { value: 'local', label: 'The customer\'s language', hint: 'Replies in Twi, Pidgin, Ga, Ewe or English - whatever the customer writes in.' },
];
const inputCls = 'w-full px-3 py-2 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md focus:outline-none focus:border-[var(--color-accent)]';

export default function WhatsAppSettingsTab() {
  const [s, setS] = useState(null);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    api.getWhatsappSettings()
      .then((data) => {
        setS(data);
        setForm({ alert_number: data.alert_number || '', place: data.place || '', language: data.language, auto_reply: data.auto_reply });
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  if (loadError) return <p className="text-sm text-[var(--color-danger)]">{loadError}</p>;
  if (!form) return <p className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]"><Loader2 size={14} className="animate-spin" /> Loading…</p>;

  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [k]: null })); setNotice(null); };

  async function save(e) {
    e.preventDefault();
    const digits = form.alert_number.replace(/\D/g, '').length;
    if (form.alert_number.trim() && (digits < 9 || digits > 15)) {
      setErrors({ alert_number: "This doesn't look like a phone number (e.g. 024 123 4567)." });
      document.getElementById('wa-alert-number')?.focus();
      return;
    }
    setBusy(true);
    try {
      const saved = await api.saveWhatsappSettings(form);
      setS((x) => ({ ...x, ...saved }));
      setForm((f) => ({ ...f, alert_number: saved.alert_number || '' }));
      setNotice({ ok: true, text: 'Saved. It applies from the next message.' });
    } catch (err) {
      setErrors(err.body?.fieldErrors || {});
      setNotice({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} noValidate className="space-y-5 max-w-2xl">
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm">
        <div><strong>Plan:</strong> {s.tier === 'reply_only'
          ? 'Reply only - your agent answers people who message you first. It never messages anyone first.'
          : 'Outreach - your agent may also message people first, within the outreach rules.'}</div>
        <div className="text-xs text-[var(--color-text-muted)] mt-1">
          Up to {s.daily_reply_limit} automatic replies a day.
          {s.warmup?.warmingUp ? ` New number warming up: day ${s.warmup.day} of ${s.warmup.of}.` : ''}
          {' '}To change your plan or limits, contact us.
        </div>
      </div>

      <div>
        <label htmlFor="wa-alert-number" className="block text-sm font-medium mb-1">Alert number <FieldTag /></label>
        <p className="text-xs text-[var(--color-text-muted)] mb-1.5">Your own WhatsApp - not the business number. When a customer needs you (a price, a complaint, a voice note), we message you here.</p>
        <input
          {...a11y('wa-alert-number', { error: errors.alert_number })}
          type="tel"
          value={form.alert_number}
          onChange={(e) => set('alert_number', e.target.value)}
          placeholder="e.g. 024 123 4567"
          className={`${inputCls} ${invalidCls(errors.alert_number)}`}
        />
        <FieldError id="wa-alert-number-error">{errors.alert_number}</FieldError>
      </div>

      <div>
        <label htmlFor="wa-place" className="block text-sm font-medium mb-1">Town or city <FieldTag /></label>
        <p className="text-xs text-[var(--color-text-muted)] mb-1.5">So your agent says "good morning" or "good evening" at the right time.</p>
        <input id="wa-place" value={form.place} onChange={(e) => set('place', e.target.value)} placeholder="e.g. Kumasi" className={inputCls} />
        <FieldError>{errors.place}</FieldError>
      </div>

      <fieldset>
        <legend className="block text-sm font-medium mb-1">Reply language <FieldTag required /></legend>
        <div className="space-y-2">
          {LANGUAGES.map((l) => (
            <label key={l.value} className="flex items-start gap-2 text-sm">
              <input type="radio" name="wa-language" value={l.value} checked={form.language === l.value} onChange={() => set('language', l.value)} className="mt-1" />
              <span>{l.label}<span className="block text-xs text-[var(--color-text-muted)]">{l.hint}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <span className="block text-sm font-medium mb-1">Automatic replies <FieldTag required /></span>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={!!form.auto_reply} onChange={(e) => set('auto_reply', e.target.checked)} className="mt-1" />
          <span>Send safe answers by themselves<span className="block text-xs text-[var(--color-text-muted)]">Off: every reply waits for your approval on the Tasks page. Prices, complaints and payments always wait.</span></span>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-[var(--color-accent)] text-black disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
        </button>
        {notice && <span className={`text-sm ${notice.ok ? 'text-emerald-600' : 'text-[var(--color-danger)]'}`}>{notice.text}</span>}
      </div>
    </form>
  );
}
