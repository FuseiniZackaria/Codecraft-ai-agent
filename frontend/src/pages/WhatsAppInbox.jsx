import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Loader2, MessageCircle, RefreshCw, Send } from 'lucide-react';
import { api } from '../services/api';
import CorrectAnswerDialog, { CorrectButton, CorrectedBadge, questionBefore } from '../components/settings/CorrectAnswer';

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

  async function queue(e) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const res = await api.queueWhatsappOutreach([{ number: number.trim(), text: text.trim() }]);
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
    <form onSubmit={queue} className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2">
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder="Number, e.g. 024 123 4567 or +233241234567"
          className="sm:w-64 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-accent)]"
        />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message"
          className="flex-1 min-w-0 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-accent)]"
        />
        <button type="submit" disabled={busy || !number.trim() || !text.trim()} className="px-3 py-2 rounded-md text-sm font-medium bg-[var(--color-accent)] text-black disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : 'Queue'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-2 py-2 text-sm text-[var(--color-text-muted)]">Cancel</button>
      </div>
      <p className="text-[11px] text-[var(--color-text-muted)]">
        To protect your number, this only works for people who have messaged your WhatsApp before and haven't replied STOP.
        Messages go out one at a time, 30-90 seconds apart.
      </p>
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
  const bottomRef = useRef(null);
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
      setMessages(await api.getWhatsappMessages(number));
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
    loadMessages(selected);
    if (!selected) return undefined;
    const t = setInterval(() => loadMessages(selected), REFRESH_MS);
    return () => clearInterval(t);
  }, [selected, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  async function send(e) {
    e.preventDefault();
    if (!text.trim() || !selected) return;
    setSending(true);
    try {
      await api.replyWhatsapp(selected, text.trim());
      setText('');
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
            <div className="flex items-center gap-2 p-4 text-sm text-[var(--color-text-muted)]"><Loader2 size={14} className="animate-spin" /> Loading…</div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-sm text-[var(--color-text-muted)]">No messages yet. When someone messages your WhatsApp, the conversation shows up here.</div>
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
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
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
                <div ref={bottomRef} />
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
