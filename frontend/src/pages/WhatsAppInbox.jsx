import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2, MessageCircle, RefreshCw, Send } from 'lucide-react';
import EmptyState from '../components/EmptyState';
import { FieldTag, FieldError, invalidCls, a11y } from '../components/ui/FormField';
import { api } from '../services/api';
import CorrectAnswerDialog, { CorrectButton, CorrectedBadge, questionBefore } from '../components/settings/CorrectAnswer';
import LoadingScreen from '../components/LoadingScreen';

/**
 * WhatsApp inbox: the signed-in admin's own conversations (WAHA session, plus
 * workspace-level Twilio messages), the message history, and a reply box.
 * Refreshes every 10 seconds while open.
 */
const REFRESH_MS = 10_000;

const time = (iso) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

const SOURCE_LABEL = { auto_reply: 'auto-reply', outreach: 'outreach', manual: 'you', agent: 'agent' };
// Replies written by the agent - these get "Correct this answer".
const AGENT_SOURCES = new Set(['auto_reply', 'agent']);

/** Start a new conversation. Goes through the outreach queue (gaps, daily limit, opt-outs), not straight out. */
function NewMessage({ onQueued }) {
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [errors, setErrors] = useState({});
  // This business's number: its plan (reply-only) and, on Meta, its approved templates.
  const [session, setSession] = useState(null);
  const [templateName, setTemplateName] = useState('');
  const [params, setParams] = useState([]);
  useEffect(() => {
    if (open && !session) api.getWhatsappSession().then(setSession).catch(() => setSession({}));
  }, [open, session]);
  const templates = session?.provider === 'meta' ? session.templates || [] : [];
  const template = templates.find((t) => t.name === templateName) || null;

  async function queue(e) {
    e.preventDefault();
    setNotice(null);
    // Both are required: say which one is missing instead of doing nothing.
    const digits = number.replace(/\D/g, '').length;
    const problems = {
      number: !number.trim() ? 'Number is required.' : digits < 9 || digits > 15 ? "This doesn't look like a phone number (e.g. 024 123 4567)." : null,
      text: template
        ? (params.slice(0, template.params).filter((p) => p?.trim()).length < template.params ? 'Fill in every template variable.' : null)
        : (text.trim() ? null : 'Message is required.'),
    };
    setErrors(problems);
    if (problems.number || problems.text) {
      document.getElementById(problems.number ? 'new-message-number' : 'new-message-text')?.focus();
      return;
    }
    setBusy(true);
    try {
      const recipient = template
        ? { number: number.trim(), template: { name: template.name, language: template.language, params: params.slice(0, template.params).map((p) => p.trim()) } }
        : { number: number.trim(), text: text.trim() };
      const res = await api.queueWhatsappOutreach([recipient]);
      if (!res.queued) throw new Error(res.rejected?.[0]?.reason || 'Not queued');
      setNotice({ ok: true, text: `Queued. It goes out within about 30-90 seconds (limit ${res.dailyLimit} a day).` });
      setNumber('');
      setText('');
      setTimeout(onQueued, 95_000);
    } catch (err) {
      setNotice({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mb-3 text-xs font-medium text-[var(--color-accent)] hover:underline">
        + New message
      </button>
    );
  }
  return (
    <form onSubmit={queue} noValidate className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
        <div className="sm:w-64">
          <label htmlFor="new-message-number" className="block text-[11px] text-[var(--color-text-muted)] mb-1">Number <FieldTag required /></label>
          <input
            {...a11y('new-message-number', { required: true, error: errors.number })}
            type="tel"
            inputMode="tel"
            value={number}
            onChange={(e) => { setNumber(e.target.value); if (errors.number) setErrors((x) => ({ ...x, number: null })); }}
            placeholder="e.g. 024 123 4567 or +233241234567"
            className={`w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-accent)] ${invalidCls(errors.number)}`}
          />
        </div>
        {templates.length > 0 && (
          <div className="sm:w-48">
            <label htmlFor="new-message-template" className="block text-[11px] text-[var(--color-text-muted)] mb-1">Send as <FieldTag required /></label>
            <select
              id="new-message-template"
              value={templateName}
              onChange={(e) => { setTemplateName(e.target.value); setParams([]); setErrors((x) => ({ ...x, text: null })); }}
              className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-2 text-sm"
            >
              <option value="">A message (replies within 24h)</option>
              {templates.map((t) => <option key={`${t.name}-${t.language}`} value={t.name}>Template: {t.name}</option>)}
            </select>
          </div>
        )}
        <div className="flex-1 min-w-0">
          {template ? (
            <>
              <label htmlFor="new-message-text" className="block text-[11px] text-[var(--color-text-muted)] mb-1">
                {template.params ? `Template variables (${template.params})` : 'Template'} <FieldTag required />
              </label>
              {template.body && <p className="text-[11px] text-[var(--color-text-muted)] mb-1">{template.body}</p>}
              <div className="flex gap-2">
                {Array.from({ length: template.params }).map((_, i) => (
                  <input
                    key={i}
                    id={i === 0 ? 'new-message-text' : undefined}
                    aria-label={`Variable {{${i + 1}}}`}
                    value={params[i] || ''}
                    onChange={(e) => { const p = [...params]; p[i] = e.target.value; setParams(p); setErrors((x) => ({ ...x, text: null })); }}
                    placeholder={`{{${i + 1}}}`}
                    className={`w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm ${invalidCls(errors.text)}`}
                  />
                ))}
                {!template.params && <span className="text-xs text-[var(--color-text-muted)] py-2">No variables - it's sent as approved.</span>}
              </div>
            </>
          ) : (
            <>
              <label htmlFor="new-message-text" className="block text-[11px] text-[var(--color-text-muted)] mb-1">Message <FieldTag required /></label>
              <input
                {...a11y('new-message-text', { required: true, error: errors.text })}
                value={text}
                onChange={(e) => { setText(e.target.value); if (errors.text) setErrors((x) => ({ ...x, text: null })); }}
                placeholder="What do you want to say?"
                className={`w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-accent)] ${invalidCls(errors.text)}`}
              />
            </>
          )}
        </div>
        <button type="submit" disabled={busy} className="px-3 py-2 rounded-md text-sm font-medium bg-[var(--color-accent)] text-black disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : 'Queue'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-2 py-2 text-sm text-[var(--color-text-muted)]">Cancel</button>
      </div>
      <p className="text-[11px] text-[var(--color-text-muted)]">
        {session?.tier === 'reply_only'
          ? 'Reply-only plan: you can message people who messaged this number before - never someone new. '
          : session?.provider === 'meta'
            ? "Meta number: someone new, or anyone who hasn't written in 24 hours, needs an approved template and must have opted in. "
            : 'You can message anyone except people who replied STOP. '}
        To protect your number from being blocked by WhatsApp, messages go out one at a time, 30-90 seconds apart, within your daily limit,
        and the same text can't go to many people.
      </p>
      <FieldError id="new-message-number-error">{errors.number}</FieldError>
      <FieldError id="new-message-text-error">{errors.text}</FieldError>
      {notice && <p className={`text-xs ${notice.ok ? 'text-emerald-600' : 'text-[var(--color-danger)]'}`}>{notice.text}</p>}
    </form>
  );
}

export default function WhatsAppInbox() {
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  // The message list scrolls to the newest message only when you open a chat, send,
  // or a new message arrives while you're already at the bottom - never while you
  // are scrolled up reading earlier messages.
  const listRef = useRef(null);
  const atBottomRef = useRef(true);
  const forceBottomRef = useRef(true);
  const lastSeenRef = useRef('');
  const [corrections, setCorrections] = useState({});
  const [correcting, setCorrecting] = useState(null); // { messageId, question, answer }

  useEffect(() => {
    // Which agent replies were already corrected (no knowledge-base access = just no badges).
    api.getCorrections().then((r) => setCorrections(r.corrections || {})).catch(() => {});
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await api.getWhatsappConversations());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (number) => {
    if (!number) return;
    try {
      const list = await api.getWhatsappMessages(number);
      // Nothing new: leave the list (and where you've scrolled to) alone.
      const sig = `${number}|${list.length}|${list[list.length - 1]?.id || ''}`;
      if (sig === lastSeenRef.current) return;
      lastSeenRef.current = sig;
      setMessages(list);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    loadConversations();
    const t = setInterval(loadConversations, REFRESH_MS);
    return () => clearInterval(t);
  }, [loadConversations]);

  useEffect(() => {
    forceBottomRef.current = true; // a newly opened chat starts at the newest message
    lastSeenRef.current = '';
    atBottomRef.current = true;
    loadMessages(selected);
    if (!selected) return undefined;
    const t = setInterval(() => loadMessages(selected), REFRESH_MS);
    return () => clearInterval(t);
  }, [selected, loadMessages]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (forceBottomRef.current || atBottomRef.current) el.scrollTop = el.scrollHeight;
    forceBottomRef.current = false;
  }, [messages]);

  function onListScroll(e) {
    const el = e.currentTarget;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function send(e) {
    e.preventDefault();
    if (!text.trim() || !selected) return;
    setSending(true);
    try {
      await api.replyWhatsapp(selected, text.trim());
      setText('');
      forceBottomRef.current = true; // show your own message
      await Promise.all([loadMessages(selected), loadConversations()]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  const current = conversations.find((c) => c.contactNumber === selected);

  return (
    <div className="p-4 md:p-6 max-w-5xl">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h1 className="text-xl font-semibold font-[var(--font-display)]">WhatsApp inbox</h1>
        <button onClick={loadConversations} className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)]" title="Refresh">
          <RefreshCw size={14} />
        </button>
      </div>
      <p className="text-sm text-[var(--color-text-muted)] mb-4">
        Your WhatsApp conversations. Replies from the agent appear here too. Connect your number on{' '}
        <Link to="/toolbox/connections" className="underline">Connections</Link>.
      </p>
      {error && <p className="text-xs text-[var(--color-danger)] mb-3">{error}</p>}

      <NewMessage onQueued={loadConversations} />

      <div className="grid md:grid-cols-[280px_1fr] gap-4 min-h-[60vh]">
        {/* Conversation list (hidden on phones while a chat is open) */}
        <div className={`rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-y-auto max-h-[70vh] ${selected ? 'hidden md:block' : ''}`}>
          {loading ? (
            <LoadingScreen compact label="Loading conversations…" />
          ) : conversations.length === 0 ? (
            <EmptyState
              compact
              icon={MessageCircle}
              title="No messages yet"
              text="When customers message your WhatsApp, the conversations show up here - and you can reply from CodeCraft."
              action={{ label: 'Connect WhatsApp', to: '/toolbox/connections' }}
            />
          ) : (
            conversations.map((c) => (
              <button
                key={c.contactNumber}
                onClick={() => setSelected(c.contactNumber)}
                className={`w-full text-left px-3 py-2.5 border-b border-[var(--color-border)] last:border-b-0 transition-colors ${
                  selected === c.contactNumber ? 'bg-[var(--color-surface-2)]' : 'hover:bg-[var(--color-surface-2)]/60'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate flex-1">{c.contactName || `+${c.contactNumber}`}</span>
                  <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">{time(c.lastAt)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  {c.unanswered && <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] shrink-0" title="Waiting for a reply" />}
                  <span className="text-xs text-[var(--color-text-muted)] truncate">{c.lastDirection === 'out' ? 'You: ' : ''}{c.lastMessage}</span>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Message history + reply box */}
        <div className={`rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col max-h-[70vh] ${selected ? '' : 'hidden md:flex'}`}>
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-sm text-[var(--color-text-muted)] p-6">
              <MessageCircle size={20} /> Pick a conversation.
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--color-border)]">
                <button onClick={() => setSelected(null)} className="md:hidden p-1 -ml-1 rounded-md text-[var(--color-text-muted)]" aria-label="Back to conversations">
                  <ArrowLeft size={16} />
                </button>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{current?.contactName || `+${selected}`}</div>
                  {current?.contactName && <div className="text-[11px] text-[var(--color-text-muted)]">+{selected}</div>}
                </div>
              </div>
              <div ref={listRef} onScroll={onListScroll} className="flex-1 overflow-y-auto p-3 space-y-2">
                {messages.map((m, i) => (
                  <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                      m.direction === 'out' ? 'bg-[var(--color-accent)]/15 text-[var(--color-text)]' : 'bg-[var(--color-surface-2)] text-[var(--color-text)]'
                    }`}>
                      {m.body}
                      <div className="text-[10px] text-[var(--color-text-muted)] mt-1 text-right">
                        {m.direction === 'out' && SOURCE_LABEL[m.source] ? `${SOURCE_LABEL[m.source]} · ` : ''}{time(m.sent_at)}
                      </div>
                      {m.direction === 'out' && AGENT_SOURCES.has(m.source) && (
                        <div className="flex items-center justify-end gap-3 mt-1">
                          {corrections[`whatsapp:${m.id}`] && <CorrectedBadge />}
                          <CorrectButton
                            corrected={!!corrections[`whatsapp:${m.id}`]}
                            onClick={() => setCorrecting({
                              messageId: m.id,
                              question: questionBefore(messages, i, (x) => x.direction === 'in'),
                              answer: m.body,
                            })}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {correcting && (
                <CorrectAnswerDialog
                  kind="whatsapp"
                  {...correcting}
                  onClose={() => setCorrecting(null)}
                  onSaved={(entry) => setCorrections((c) => ({ ...c, [`whatsapp:${correcting.messageId}`]: entry.id }))}
                />
              )}
              <form onSubmit={send} className="flex gap-2 p-3 border-t border-[var(--color-border)]">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Type a reply…"
                  className="flex-1 min-w-0 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-accent)]"
                />
                <button
                  type="submit"
                  disabled={sending || !text.trim()}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-[var(--color-accent)] text-black disabled:opacity-50"
                >
                  {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
