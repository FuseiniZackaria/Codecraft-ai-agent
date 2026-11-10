import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Save, Plus, Trash2, Mail, Building2, User, Phone, Globe, MapPin, FileText, AlertCircle, CheckCircle2, Settings as SettingsIcon } from 'lucide-react';
import AgentInstructionsTab from '../components/settings/AgentInstructionsTab';
import { PageHeader } from '../components/ui/Card';
import QaTab from '../components/settings/QaTab';
import DocumentsTab from '../components/settings/DocumentsTab';
import TestChatTab from '../components/settings/TestChatTab';
import ProductsTab from '../components/settings/ProductsTab';
import WhatsAppSettingsTab from '../components/settings/WhatsAppSettingsTab';
import { api } from '../services/api';
import LoadingScreen from '../components/LoadingScreen';
import { PROFILE_RULES, validateProfileForm, fieldError, isEmail } from '../components/settings/profileRules';
import { FieldTag } from '../components/ui/FormField';

// Mirrors the backend's ALLOWED_FIELDS and column names in business_profile.
// Keep in sync with backend/api/businessProfileRoutes.js when the schema grows.
const FIELDS = [
  { key: 'business_name',   label: 'Business name',         icon: Building2, placeholder: 'e.g. Zackaria & Co.', autoComplete: 'organization' },
  { key: 'display_name',    label: 'Your name',             icon: User,      placeholder: 'How you want messages signed off', autoComplete: 'name' },
  { key: 'title',           label: 'Your title',            icon: User,      placeholder: 'e.g. Founder, Head of Sales' },
  { key: 'business_email',  label: 'Business email',        icon: Mail,      placeholder: 'The address outreach is sent from', type: 'email' },
  { key: 'phone',           label: 'Phone number',          icon: Phone,     placeholder: '+233 ...', type: 'tel' },
  { key: 'whatsapp',        label: 'WhatsApp number',       icon: Phone,     placeholder: '+233 ...', type: 'tel' },
  { key: 'website',         label: 'Website',               icon: Globe,     placeholder: 'e.g. yourbusiness.com', type: 'url' },
  { key: 'location',        label: 'Location',              icon: MapPin,    placeholder: 'City, Country' },
];

const LONG_FIELDS = [
  { key: 'offers',    label: 'What you offer',  icon: FileText,  placeholder: 'A short paragraph outreach prompts can pull from.' },
  { key: 'signature', label: 'Email signature', icon: FileText,  placeholder: '— Your name\nTitle, Business name\nPhone • Website' },
];
// "Voice & tone" now lives in the Agent instructions tab (its "## Email & outreach tone" section).

// Tabs on this page.
const TABS = [
  { key: 'profile', label: 'Profile' },
  { key: 'agent',   label: 'Agent instructions' },
  { key: 'qa',      label: 'Q&A' },
  { key: 'docs',    label: 'Documents' },
  { key: 'products', label: 'Products' },
  { key: 'test',    label: 'Test chat' },
  { key: 'whatsapp', label: 'WhatsApp' },
];

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'profile';
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader
        icon={SettingsIcon}
        title="Settings"
        subtitle="Your business profile and how your WhatsApp agent replies. Changes apply from the agent's next reply."
      />
      <div role="tablist" className="flex gap-1 border-b border-[var(--color-border)] mb-6">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            data-tour={`tab-${t.key}`}
            type="button"
            aria-selected={tab === t.key}
            onClick={() => setParams(t.key === 'profile' ? {} : { tab: t.key })}
            className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === t.key
              ? 'border-[var(--color-accent)] text-[var(--color-text)] font-medium'
              : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'profile' && <ProfileTab />}
      {tab === 'agent' && <AgentInstructionsTab />}
      {tab === 'qa' && <QaTab />}
      {tab === 'docs' && <DocumentsTab />}
      {tab === 'products' && <ProductsTab />}
      {tab === 'test' && <TestChatTab />}
      {tab === 'whatsapp' && <WhatsAppSettingsTab />}
    </div>
  );
}

const inputBase = 'w-full px-3 py-2 text-sm bg-[var(--color-surface-2)] border rounded-md focus:outline-none';
const inputCls = (bad) => `${inputBase} ${bad ? 'border-[var(--color-danger)] focus:border-[var(--color-danger)]' : 'border-[var(--color-border)] focus:border-[var(--color-accent)]'}`;

function ProfileTab() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [triedSave, setTriedSave] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [workspaceId, setWorkspaceId] = useState(null);
  const [form, setForm] = useState({});
  const [extraEmails, setExtraEmails] = useState([]);
  const [newEmail, setNewEmail] = useState('');
  const [emailError, setEmailError] = useState(null);
  const formRef = useRef(null);

  function fill(profile) {
    const initial = {};
    for (const f of [...FIELDS, ...LONG_FIELDS]) initial[f.key] = profile?.[f.key] || '';
    setForm(initial);
    setExtraEmails(Array.isArray(profile?.extra_email_addresses) ? profile.extra_email_addresses : []);
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.getBusinessProfile();
        fill(res.profile || res);
        setWorkspaceId(res.workspaceId || null);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSavedAt(null);
    // Once they've tried to save (or a field already shows a problem), messages update as they type.
    if (triedSave || fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        const problem = fieldError(key, value);
        if (problem) next[key] = problem; else delete next[key];
        return next;
      });
    }
  }

  // Optional fields are checked when you leave them, so a typo shows straight away.
  function onBlur(key) {
    const problem = fieldError(key, form[key]);
    const required = PROFILE_RULES[key]?.required;
    if (problem && (!required || triedSave)) setFieldErrors((prev) => ({ ...prev, [key]: problem }));
  }

  function addEmail() {
    const trimmed = newEmail.trim().toLowerCase();
    if (!trimmed) return;
    if (!isEmail(trimmed)) { setEmailError(`"${trimmed}" doesn't look like an email address.`); return; }
    if (extraEmails.includes(trimmed)) { setEmailError(`${trimmed} is already in the list.`); return; }
    if (extraEmails.length >= 20) { setEmailError('You can add up to 20 other email addresses.'); return; }
    setExtraEmails([...extraEmails, trimmed]);
    setNewEmail('');
    setEmailError(null);
    setSavedAt(null);
  }

  function removeEmail(email) {
    setExtraEmails(extraEmails.filter((e) => e !== email));
    setSavedAt(null);
  }

  function focusFirst(errors) {
    const first = [...FIELDS, ...LONG_FIELDS].find((f) => errors[f.key]);
    if (!first) return;
    const el = formRef.current?.querySelector(`#${first.key}`);
    el?.focus();
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  async function handleSave(e) {
    e.preventDefault();
    setTriedSave(true);
    setError(null);
    setSavedAt(null);

    // Check everything first: required fields filled in, optional ones (if filled in) valid.
    const errors = validateProfileForm(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length) {
      focusFirst(errors);
      return;
    }

    setSaving(true);
    const patch = { extra_email_addresses: extraEmails };
    // Every field is sent, so a cleared optional field is saved as empty.
    for (const f of [...FIELDS, ...LONG_FIELDS]) patch[f.key] = form[f.key] ?? '';
    try {
      const res = await api.saveBusinessProfile(patch);
      fill(res.profile || {});
      setFieldErrors({});
      setTriedSave(false);
      setSavedAt(new Date());
    } catch (err) {
      // The server checks the same rules; show its messages next to the fields.
      const serverErrors = err.body?.fieldErrors || {};
      if (Object.keys(serverErrors).length) {
        setFieldErrors(serverErrors);
        if (serverErrors.extra_email_addresses) setEmailError(serverErrors.extra_email_addresses);
        focusFirst(serverErrors);
      } else {
        setError(err.message);
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <LoadingScreen compact label="Loading your business profile…" />
    );
  }

  const problems = [...FIELDS, ...LONG_FIELDS].filter((f) => fieldErrors[f.key]);
  const missingRequired = problems.filter((f) => PROFILE_RULES[f.key]?.required && !String(form[f.key] || '').trim());
  const badOptional = problems.filter((f) => !missingRequired.includes(f));

  const renderField = (f, long = false) => {
    const Icon = f.icon;
    const rule = PROFILE_RULES[f.key] || {};
    const problem = fieldErrors[f.key];
    const common = {
      id: f.key,
      value: form[f.key] || '',
      onChange: (e) => setField(f.key, e.target.value),
      onBlur: () => onBlur(f.key),
      placeholder: f.placeholder,
      maxLength: rule.max,
      'aria-required': rule.required ? 'true' : undefined,
      'aria-invalid': problem ? 'true' : undefined,
      'aria-describedby': problem ? `${f.key}-error` : undefined,
    };
    return (
      <div key={f.key}>
        <label htmlFor={f.key} className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-muted)] mb-1.5">
          <Icon size={12} /> {f.label} <FieldTag required={rule.required} />
        </label>
        {long ? (
          <textarea {...common} rows={f.key === 'signature' ? 4 : 3} className={`${inputCls(problem)} font-[var(--font-mono)]`} />
        ) : (
          <input
            {...common}
            type={f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text'}
            inputMode={f.type === 'tel' ? 'tel' : f.type === 'url' ? 'url' : undefined}
            autoComplete={f.autoComplete || (f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : f.type === 'url' ? 'url' : 'off')}
            className={inputCls(problem)}
          />
        )}
        {problem && (
          <p id={`${f.key}-error`} className="mt-1 text-xs text-[var(--color-danger)] flex items-center gap-1">
            <AlertCircle size={11} className="shrink-0" /> {problem}
          </p>
        )}
      </div>
    );
  };

  return (
    <div>
      <p className="text-sm text-[var(--color-text-muted)] mb-2">
        Agents use these fields when they draft outreach, sign emails, triage the
        inbox and reply on WhatsApp.
      </p>
      <p className="text-xs text-[var(--color-text-muted)] mb-6">
        Fields marked <span className="font-semibold text-[var(--color-danger)]">Required *</span> must be filled in before you can save.
        Optional fields can be left empty - blank ones fall back to the server-wide defaults.
      </p>

      <form ref={formRef} onSubmit={handleSave} noValidate className="space-y-6">
        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-5">
          <h2 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
            <Building2 size={14} /> Business basics
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {FIELDS.map((f) => renderField(f))}
          </div>
        </section>

        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-5">
          <h2 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
            <FileText size={14} /> Offers and signature
          </h2>
          <div className="space-y-4">
            {LONG_FIELDS.map((f) => renderField(f, true))}
          </div>
        </section>

        <section className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-5">
          <h2 className="text-sm font-semibold text-[var(--color-text)] mb-1 flex items-center gap-2">
            <Mail size={14} /> Other email addresses I use <FieldTag />
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
                <span className="font-[var(--font-mono)] break-all">{email}</span>
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
              onChange={(e) => { setNewEmail(e.target.value); setEmailError(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addEmail();
                }
              }}
              placeholder="another-address@example.com"
              aria-label="Another email address"
              aria-invalid={emailError ? 'true' : undefined}
              className={`flex-1 min-w-0 ${inputCls(emailError)}`}
            />
            <button
              type="button"
              onClick={addEmail}
              className="px-3 py-2 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md hover:bg-[var(--color-surface-3)] flex items-center gap-1.5"
            >
              <Plus size={14} /> Add
            </button>
          </div>
          {emailError && (
            <p className="mt-1 text-xs text-[var(--color-danger)] flex items-center gap-1"><AlertCircle size={11} className="shrink-0" /> {emailError}</p>
          )}
          {newEmail.trim() && !emailError && (
            <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Click Add (or press Enter) to put it on the list.</p>
          )}
        </section>

        {problems.length > 0 && (
          <div role="alert" className="flex items-start gap-2 p-3 bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 rounded-md text-sm text-[var(--color-danger)]">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <div>
              {missingRequired.length > 0 && (
                <div>Please fill in the required {missingRequired.length === 1 ? 'field' : 'fields'}: <strong>{missingRequired.map((f) => f.label).join(', ')}</strong>.</div>
              )}
              {badOptional.length > 0 && (
                <div>Please check: <strong>{badOptional.map((f) => f.label).join(', ')}</strong> - or leave {badOptional.length === 1 ? 'it' : 'them'} empty, {badOptional.length === 1 ? 'it is' : 'they are'} optional.</div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 p-3 bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 rounded-md text-sm text-[var(--color-danger)] whitespace-pre-wrap">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
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
