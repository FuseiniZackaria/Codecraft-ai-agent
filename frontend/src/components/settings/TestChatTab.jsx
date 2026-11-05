import { useEffect, useRef, useState } from 'react';
import { Send, RotateCcw, Loader2, AlertCircle, CheckCircle2, Clock, HelpCircle, FileText, ShieldCheck, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../../services/api';

// Settings -> General -> Test chat.
// Message the WhatsApp agent as if you were a customer. It replies with the
// current instructions, Q&A and documents - nothing is ever sent to anyone.

function time(iso) {
  try { return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
}

function SourceChip({ s }) {
  const [open, setOpen] = useState(false);
  const Icon = s.type === 'qa' ? HelpCircle : FileText;
  return (
    <div className="text-xs">
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1.5 text-left hover:underline">
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Icon size={11} className="shrink-0" />
        <span className="font-mono text-[10px] text-[var(--color-text-muted)]">{s.label}</span>
        <span className="truncate max-w-[22rem]">{s.type === 'qa' ? `Q&A: ${s.title}` : `${s.title} (section ${s.section})`}</span>
      </button>
      {open && <div className="ml-6 mt-1 p-2 rounded bg-[var(--color-surface-3)] whitespace-pre-wrap text-[var(--color-text-muted)]">{s.snippet}{s.snippet?.length >= 300 ? '…' : ''}</div>}
    </div>
  );
}

function Sources({ sources }) {
  const [showOthers, setShowOthers] = useState(false);
  if (!sources?.length) {
    return <div className="text-[11px] text-[var(--color-text-muted)] italic">No Q&A or documents were given to the agent for this message.</div>;
  }
  const used = sources.filter((s) => s.used);
  const others = sources.filter((s) => !s.used);
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-[var(--color-text-muted)]">
        {used.length ? 'Used to answer:' : 'The agent says it didn\'t use any of your Q&A or documents for this reply.'}
      </div>
      {used.map((s) => <SourceChip key={s.label} s={s} />)}
      {others.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowOthers(!showOthers)} className="text-[11px] text-[var(--color-text-muted)] hover:underline flex items-center gap-1">
            {showOthers ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Also given but not used ({others.length})
          </button>
          {showOthers && <div className="mt-1 space-y-1">{others.map((s) => <SourceChip key={s.label} s={s} />)}</div>}
        </div>
      )}
    </div>
  );
}

function AgentBubble({ m, agentName }) {
  const meta = m.meta || {};
  if (meta.error) {
    return (
      <div className="max-w-[85%] p-3 rounded-lg bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 text-sm text-[var(--color-danger)] flex items-start gap-2">
        <AlertCircle size={14} className="mt-0.5 shrink-0" /> <span>{meta.error}</span>
      </div>
    );
  }
  return (
    <div className="max-w-[85%] space-y-2">
      <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm whitespace-pre-wrap">
        {m.body}
        <div className="text-[10px] text-[var(--color-text-muted)] mt-1 text-right">{agentName} · {time(m.created_at)}</div>
      </div>
      <div className="p-3 rounded-lg bg-[var(--color-surface-2)] border border-[var(--color-border)] space-y-2">
        {meta.held ? (
          <div className="text-xs text-amber-500 flex items-start gap-1.5">
            <Clock size={12} className="mt-0.5 shrink-0" />
            <span><span className="font-medium">A real customer would get the message above, and this would wait for your approval</span> because {meta.reason || 'the agent was unsure'}.</span>
          </div>
        ) : (
          <div className="text-xs text-emerald-500 flex items-center gap-1.5">
            <CheckCircle2 size={12} /> <span className="font-medium">Would be sent straight away</span>{meta.autoReplyOn === false ? ' (if auto-reply were on - it is currently off, so every reply waits for you)' : ''}
          </div>
        )}
        {meta.held && meta.draft && (
          <div className="text-xs">
            <div className="text-[var(--color-text-muted)] mb-0.5">{agentName}'s suggested answer (you'd approve or edit it on the Tasks page):</div>
            <div className="whitespace-pre-wrap p-2 rounded bg-[var(--color-surface-3)]">{meta.draft}</div>
          </div>
        )}
        <Sources sources={meta.sources} />
        {meta.instructionsVersion && <div className="text-[10px] text-[var(--color-text-muted)]">Instructions version {meta.instructionsVersion}</div>}
      </div>
    </div>
  );
}

export default function TestChatTab() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [maxText, setMaxText] = useState(2000);
  const [agentName, setAgentName] = useState('Agent');
  const endRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const [chat, settings] = await Promise.all([api.getTestChat(), api.getAgentSettings().catch(() => null)]);
        setMessages(chat.messages || []);
        if (chat.maxText) setMaxText(chat.maxText);
        if (settings?.active?.agent_name) setAgentName(settings.active.agent_name);
      } catch (err) {
        setLoadError(err.message);
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, sending]);

  async function send(e) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setError(null);
    setText('');
    const temp = { id: `temp-${Date.now()}`, role: 'customer', body: t, created_at: new Date().toISOString() };
    setMessages((list) => [...list, temp]);
    try {
      const res = await api.sendTestChat(t);
      setMessages((list) => [...list.filter((m) => m.id !== temp.id), res.customer, res.agent]);
    } catch (err) {
      setMessages((list) => list.filter((m) => m.id !== temp.id));
      setText(t);
      setError(err.message);
    }
    setSending(false);
  }

  async function startOver() {
    if (!messages.length || !window.confirm('Clear this test conversation and start over?')) return;
    try { await api.clearTestChat(); setMessages([]); setError(null); } catch (err) { setError(err.message); }
  }

  if (loading) return <div className="text-sm text-[var(--color-text-muted)]">Loading the test chat…</div>;
  if (loadError) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-5 text-sm flex items-start gap-2 text-[var(--color-danger)]">
        <AlertCircle size={16} className="mt-0.5 shrink-0" /><div><div className="font-medium mb-1">Couldn't load the test chat</div><div className="text-[var(--color-text-muted)]">{loadError}</div></div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg flex flex-col h-[70vh] min-h-[420px]">
      <div className="px-5 py-3 border-b border-[var(--color-border)] flex items-center justify-between gap-3">
        <div className="text-xs text-[var(--color-text-muted)] flex items-start gap-1.5">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-500" />
          <span>Write as if you were a customer. {agentName} replies with your current instructions, Q&A and documents. <span className="font-medium">Nothing here is sent to anyone.</span> Each message is a real AI call.</span>
        </div>
        <button type="button" onClick={startOver} disabled={!messages.length || sending}
          className="px-2.5 py-1.5 text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md hover:bg-[var(--color-surface-3)] flex items-center gap-1.5 disabled:opacity-50 shrink-0">
          <RotateCcw size={12} /> Start over
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-sm text-[var(--color-text-muted)] text-center mt-10">
            Try the questions your customers ask most - "Do you deliver?", "How much is…?", "Are you open on Sunday?"
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'customer' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'customer' ? (
              <div className="max-w-[75%] p-3 rounded-lg bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/30 text-sm whitespace-pre-wrap">
                {m.body}
                <div className="text-[10px] text-[var(--color-text-muted)] mt-1 text-right">You (as a customer) · {time(m.created_at)}</div>
              </div>
            ) : (
              <AgentBubble m={m} agentName={agentName} />
            )}
          </div>
        ))}
        {sending && (
          <div className="flex justify-start"><div className="p-3 rounded-lg bg-[var(--color-surface-2)] text-xs text-[var(--color-text-muted)] flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> {agentName} is typing…</div></div>
        )}
        <div ref={endRef} />
      </div>

      {error && <div className="mx-5 mb-2 text-xs text-[var(--color-danger)] flex items-center gap-1.5"><AlertCircle size={12} /> {error}</div>}
      <form onSubmit={send} className="px-5 py-3 border-t border-[var(--color-border)] flex gap-2">
        <textarea
          rows={1}
          value={text}
          maxLength={maxText}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }}
          placeholder="Type a customer message… (Enter to send, Shift+Enter for a new line)"
          aria-label="Test message"
          className="flex-1 px-3 py-2 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md focus:outline-none focus:border-[var(--color-accent)] resize-none"
        />
        <button type="submit" disabled={sending || !text.trim()}
          className="px-4 py-2 text-sm bg-[var(--color-accent)] text-black rounded-md hover:opacity-90 disabled:opacity-50 flex items-center gap-2 font-medium">
          <Send size={14} /> Send
        </button>
      </form>
    </div>
  );
}
