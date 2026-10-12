import { useEffect, useRef, useState } from 'react';
import { Save, Plus, Trash2, Mail, Building2, User, Phone, Globe, MapPin, FileText, Volume2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { api } from '../services/api';

// Mirrors the backend's ALLOWED_FIELDS and column names in business_profile.
// Keep in sync with backend/api/businessProfileRoutes.js when the schema grows.
const FIELDS = [
  { key: 'business_name',   label: 'Business name',         icon: Building2, placeholder: 'e.g. Zackaria & Co.' },
  { key: 'display_name',    label: 'Your name',             icon: User,      placeholder: 'How you want messages signed off' },
  { key: 'title',           label: 'Your title',            icon: User,      placeholder: 'e.g. Founder, Head of Sales' },
  { key: 'business_email',  label: 'Business email',        icon: Mail,      placeholder: 'The address outreach is sent from' },
  { key: 'phone',           label: 'Phone number',          icon: Phone,     placeholder: '+233 ...' },
  { key: 'whatsapp',        label: 'WhatsApp number',       icon: Phone,     placeholder: '+233 ...' },
  { key: 'website',         label: 'Website',               icon: Globe,     placeholder: 'https://...' },
  { key: 'location',        label: 'Location',              icon: MapPin,    placeholder: 'City, Country' },
];

const LONG_FIELDS = [
  { key: 'offers',    label: 'What you offer',  icon: FileText,  placeholder: 'A short paragraph outreach prompts can pull from.' },
  { key: 'signature', label: 'Email signature', icon: FileText,  placeholder: '— Your name\nTitle, Business name\nPhone • Website' },
  { key: 'tone',      label: 'Voice & tone',    icon: Volume2,   placeholder: 'e.g. warm, direct, Ghanaian small-business tone' },
];

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const [workspaceId, setWorkspaceId] = useState(null);
  const [form, setForm] = useState({});
  const [extraEmails, setExtraEmails] = useState([]);
  const [newEmail, setNewEmail] = useState('');
  const originalRef = useRef(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      const res = await api.getBusinessProfile();
      if (!res?.ok && res?.error) {
        setError(res.error);
        setLoading(false);
        return;
      }
      const profile = res.profile || res;
      const initial = {};
      for (const f of [...FIELDS, ...LONG_FIELDS]) initial[f.key] = profile[f.key] || '';
      setForm(initial);
      setExtraEmails(Array.isArray(profile.extra_email_addresses) ? profile.extra_email_addresses : []);
      setWorkspaceId(res.workspaceId || null);
      originalRef.current = { ...initial, extra_email_addresses: [...(profile.extra_email_addresses || [])] };
      setLoading(false);
    })();
  }, []);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSavedAt(null);
  }

  function addEmail() {
    const trimmed = newEmail.trim().toLowerCase();
    if (!trimmed) return;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!re.test(trimmed)) {
      setError(`"${trimmed}" doesn't look like an email address.`);
      return;
    }
    if (extraEmails.includes(trimmed)) {
      setError(`${trimmed} is already in the list.`);
      return;
    }
    setExtraEmails([...extraEmails, trimmed]);
    setNewEmail('');
    setError(null);
    setSavedAt(null);
  }

  function removeEmail(email) {
    setExtraEmails(extraEmails.filter((e) => e !== email));
    setSavedAt(null);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const patch = { extra_email_addresses: extraEmails };
    for (const f of [...FIELDS, ...LONG_FIELDS]) {
      // Send every field so a cleared value becomes null; the backend
      // handles '' → null and respects the strict allowlist.
      patch[f.key] = form[f.key] ?? '';
    }
    const res = await api.saveBusinessProfile(patch);
    if (!res?.ok && res?.error) {
      setError(res.error + (res.details ? `\n\n${res.details.join('\n')}` : ''));
      setSaving(false);
      return;
    }
    const next = res.profile || {};
    const initial = {};
    for (const f of [...FIELDS, ...LONG_FIELDS]) initial[f.key] = next[f.key] || '';
    setForm(initial);
    setExtraEmails(Array.isArray(next.extra_email_addresses) ? next.extra_email_addresses : []);
    originalRef.current = { ...initial, extra_email_addresses: [...(next.extra_email_addresses || [])] };
    setSaving(false);
    setSavedAt(new Date());
  }

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="text-sm text-[var(--color-text-muted)]">Loading your business profile…</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-[var(--font-display)] font-semibold mb-1">Settings</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Your business profile. Agents use these fields when they draft outreach,
          sign emails, and triage the inbox. Blank fields fall back to the
          server-wide defaults.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-5">
          <h2 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
            <Building2 size={14} /> Business basics
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {FIELDS.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.key}>
                  <label htmlFor={f.key} className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-muted)] mb-1.5">
                    <Icon size={12} /> {f.label}
                  </label>
                  <input
                    id={f.key}
                    type="text"
                    value={form[f.key] || ''}
                    onChange={(e) => setField(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    className="w-full px-3 py-2 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md focus:outline-none focus:border-[var(--color-accent)]"
                  />
                </div>
              );
            })}
          </div>
        </section>

        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-5">
          <h2 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
            <FileText size={14} /> Voice, offers, signature
          </h2>
          <div className="space-y-4">
            {LONG_FIELDS.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.key}>
                  <label htmlFor={f.key} className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-muted)] mb-1.5">
                    <Icon size={12} /> {f.label}
                  </label>
                  <textarea
                    id={f.key}
                    rows={f.key === 'signature' ? 4 : 3}
                    value={form[f.key] || ''}
                    onChange={(e) => setField(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    className="w-full px-3 py-2 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md focus:outline-none focus:border-[var(--color-accent)] font-[var(--font-mono)]"
                  />
                </div>
              );
            })}
          </div>
        </section>

        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-5">
          <h2 className="text-sm font-semibold text-[var(--color-text)] mb-1 flex items-center gap-2">
            <Mail size={14} /> Other email addresses I use
          </h2>
          <p className="text-xs text-[var(--color-text-muted)] mb-4">
            Inbox triage treats emails from these addresses as yours and never
            drafts a reply to them. Add every address you send mail from —
            personal, aliases, work accounts.
          </p>

          <div className="space-y-2 mb-3">
            {extraEmails.length === 0 && (
              <div className="text-xs text-[var(--color-text-muted)] italic">No extra addresses yet.</div>
            )}
            {extraEmails.map((email) => (
              <div key={email} className="flex items-center justify-between gap-2 px-3 py-2 bg-[var(--color-surface-2)] rounded-md text-sm">
                <span className="font-[var(--font-mono)]">{email}</span>
                <button
                  type="button"
                  onClick={() => removeEmail(email)}
                  className="p-1 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-danger)]"
                  aria-label={`Remove ${email}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addEmail();
                }
              }}
              placeholder="another-address@example.com"
              className="flex-1 px-3 py-2 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md focus:outline-none focus:border-[var(--color-accent)]"
            />
            <button
              type="button"
              onClick={addEmail}
              className="px-3 py-2 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md hover:bg-[var(--color-surface-3)] flex items-center gap-1.5"
            >
              <Plus size={14} /> Add
            </button>
          </div>
        </section>

        {error && (
          <div className="flex items-start gap-2 p-3 bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 rounded-md text-sm text-[var(--color-danger)] whitespace-pre-wrap">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-sm bg-[var(--color-accent)] text-black rounded-md hover:opacity-90 disabled:opacity-50 flex items-center gap-2 font-medium"
          >
            <Save size={14} />
            {saving ? 'Saving…' : 'Save'}
          </button>
          {savedAt && (
            <span className="text-xs text-[var(--color-text-muted)] flex items-center gap-1.5">
              <CheckCircle2 size={12} className="text-emerald-500" />
              Saved at {savedAt.toLocaleTimeString()}
            </span>
          )}
          {!workspaceId && (
            <span className="text-xs text-amber-500 flex items-center gap-1.5">
              <AlertCircle size={12} />
              No workspace resolved — run migration 0001 before saving.
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
