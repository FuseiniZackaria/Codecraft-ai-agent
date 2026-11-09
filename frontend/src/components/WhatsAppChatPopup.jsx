import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { create } from 'zustand';
import { X, Send, Loader2, ExternalLink, MessageCircle } from 'lucide-react';
import { api } from '../services/api';
import { useNavRequest } from './AssistantNavigator';

/**
 * A WhatsApp conversation in a pop-up window, opened from anywhere - e.g.
 * when you ask Ian "open Perry's WhatsApp". Shows the messages (refreshing
 * while open) and lets you reply, like Work -> Inbox.
 */
export const useChatPopup = create((set) => ({
  chat: null, // { number, name }
  open: (number, name) => set({ chat: { number, name: name || null } }),
  close: () => set({ chat: null }),
}));

/** Call with any assistant stream event: opens a chat or a page when Ian's tool asks for it. */
export function handleAssistantUi(event) {
  const ui = event?.type === 'tool_end' ? event.result?.ui : null;
  if (ui?.action === 'open_whatsapp_chat' && ui.number) useChatPopup.getState().open(ui.number, ui.name);
  if (ui?.action === 'navigate' && ui.path) useNavRequest.getState().go(ui.path);
}

const REFRESH_MS = 5000;
const time = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

export default function WhatsAppChatPopup() {
  const chat = useChatPopup((s) => s.chat);
  const close = useChatPopup((s) => s.close);
  if (!chat) return null;
  return <ChatWindow key={chat.number} chat={chat} onClose={close} />;
}

function ChatWindow({ chat, onClose }) {
  const [messages, setMessages] = useState(null);
  const [error, setError] = useState(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const atBottom = useRef(true);
  const lastSig = useRef('');

  const load = useCallback(async () => {
    try {
      const list = await api.getWhatsappMessages(chat.number);
      const sig = `${list.length}|${list[list.length - 1]?.id || ''}`;
      if (sig === lastSig.current) return;
      lastSig.current = sig;
      setMessages(list);
      setError(null);
    } catch (err) {
      setError(err.message);
      setMessages((m) => m || []);
    }
  }, [chat.number]);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  // Newest message in view - unless you've scrolled up to read older ones.
  useEffect(() => {
    const el = listRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function send(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      await api.replyWhatsapp(chat.number, text.trim());
      setText('');
      atBottom.current = true;
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  const title = chat.name || `+${chat.number}`;
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={`WhatsApp chat with ${title}`}>
      <div className="w-full sm:max-w-md h-[85dvh] sm:h-[70vh] flex flex-col bg-[var(--color-surface)] border border-[var(--color-border)] rounded-t-2xl sm:rounded-xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 bg-[var(--color-brand)] text-white">
          <MessageCircle size={16} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold truncate">{title}</div>
            {chat.name && <div className="text-[11px] text-white/70">+{chat.number}</div>}
          </div>
          <Link to="/work/inbox" onClick={onClose} className="p-1.5 rounded-md text-white/80 hover:text-white hover:bg-white/10" title="Open in Inbox" aria-label="Open in Inbox">
            <ExternalLink size={15} />
          </Link>
          <button type="button" onClick={onClose} className="p-1.5 rounded-md text-white/80 hover:text-white hover:bg-white/10" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div
          ref={listRef}
          onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
          className="flex-1 overflow-y-auto p-3 space-y-2 bg-[var(--color-surface-2)]"
        >
          {messages === null ? (
            <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-muted)] gap-2"><Loader2 size={14} className="animate-spin" /> Loading messages…</div>
          ) : messages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-[var(--color-text-muted)]">No messages with {title} yet.</div>
          ) : messages.map((m) => (
            <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                m.direction === 'out' ? 'bg-[var(--color-accent)]/15 text-[var(--color-text)]' : 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)]'
              }`}>
                {m.body}
                <div className="text-[10px] text-[var(--color-text-muted)] mt-1 text-right">{time(m.sent_at)}</div>
              </div>
            </div>
          ))}
        </div>

        {error && <div className="px-3 py-1.5 text-xs text-[var(--color-danger)] border-t border-[var(--color-border)]">{error}</div>}

        <form onSubmit={send} className="flex gap-2 p-3 border-t border-[var(--color-border)]">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Reply to ${title}…`}
            aria-label="Your reply"
            className="flex-1 min-w-0 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-accent)]"
          />
          <button type="submit" disabled={sending || !text.trim()} className="px-3 py-2 rounded-md bg-[var(--color-accent)] text-black disabled:opacity-50" aria-label="Send">
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
        </form>
      </div>
    </div>
  );
}
