import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, ListChecks, Paperclip, Mic, MicOff, X, FileText, Image as ImageIcon, ChevronDown, ChevronUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore } from '../store/useStore';
import { api } from '../services/api';
import StatusPill from '../components/StatusPill';

const ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // legacy .xls
];
const MAX_FILE_MB = 20;

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function AttachmentChip({ file, onRemove }) {
  const isImage = file.type.startsWith('image/');
  return (
    <div className="flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md bg-[var(--color-surface-2)] border border-[var(--color-border)] text-xs">
      {isImage ? <ImageIcon size={12} className="text-[var(--color-text-muted)]" /> : <FileText size={12} className="text-[var(--color-text-muted)]" />}
      <span className="max-w-[140px] truncate">{file.name}</span>
      <button onClick={onRemove} className="p-0.5 rounded hover:bg-[var(--color-border)] text-[var(--color-text-muted)]">
        <X size={11} />
      </button>
    </div>
  );
}

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;

function linkify(text) {
  const parts = text.split(URL_PATTERN);
  return parts.map((part, i) =>
    URL_PATTERN.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noreferrer"
        className="underline hover:no-underline break-all"
      >
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

const LONG_MESSAGE_THRESHOLD = 500;

function Bubble({ msg }) {
  const isUser = msg.role === 'user';
  const [collapsed, setCollapsed] = useState((msg.content?.length || 0) > LONG_MESSAGE_THRESHOLD);
  const tasks = useStore((s) => s.tasks);
  // Live status: look up the current task by id (kept fresh by the store's
  // background poll) rather than the frozen snapshot captured when this
  // message was first created - otherwise the pill never updates after
  // you approve/reject it elsewhere.
  const liveTask = msg.task ? tasks.find((t) => t.id === msg.task.id) || msg.task : null;

  const isLong = (msg.content?.length || 0) > LONG_MESSAGE_THRESHOLD;
  const displayContent = collapsed && isLong ? `${msg.content.slice(0, LONG_MESSAGE_THRESHOLD)}...` : msg.content;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-lg px-3.5 py-2.5 text-sm ${
          isUser
            ? 'bg-[var(--color-accent)] text-black'
            : 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)]'
        }`}
      >
        {msg.attachmentNames?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {msg.attachmentNames.map((name, i) => (
              <span
                key={i}
                className={`flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded ${
                  isUser ? 'bg-black/15' : 'bg-[var(--color-surface-2)]'
                }`}
              >
                <Paperclip size={10} /> {name}
              </span>
            ))}
          </div>
        )}

        {msg.content && (
          <div className={`${isUser ? 'prose-codecraft-on-accent' : 'prose-codecraft'} prose prose-sm max-w-none`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayContent}</ReactMarkdown>
          </div>
        )}

        {isLong && (
          <button
            onClick={() => setCollapsed((c) => !c)}
            className={`mt-1.5 flex items-center gap-1 text-xs hover:underline ${isUser ? 'text-black/70' : 'text-[var(--color-text-muted)]'}`}
          >
            {collapsed ? 'Show full message' : 'Show less'}
            {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>
        )}

        {liveTask && (
          <Link
            to="/tasks"
            className={`mt-2 flex items-center gap-1.5 text-xs pt-2 border-t ${
              isUser ? 'border-black/20' : 'border-[var(--color-border)]'
            } ${isUser ? 'text-black/70' : 'text-[var(--color-text-muted)]'} hover:underline w-fit`}
          >
            <ListChecks size={12} />
            {liveTask.instruction}
            <StatusPill status={liveTask.status} />
          </Link>
        )}
      </div>
    </div>
  );
}

export default function Chat() {
  const { connected, chatMessages, addChatMessage } = useStore();
  const [input, setInput] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [liveNarration, setLiveNarration] = useState(null);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);

  // While waiting on a reply, listen for real, live narration from
  // whatever agent is working (e.g. the Coding Agent describing each file
  // as it writes it) and show that instead of a static "…" placeholder.
  // The chat endpoint is a single blocking request that only resolves once
  // the whole thing finishes, so this is a separate live channel running
  // alongside it, not something threaded through the request itself.
  useEffect(() => {
    if (!busy) {
      setLiveNarration(null);
      return;
    }
    const es = new EventSource(api.eventsStreamUrl());
    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data);
        if (event.action === 'narration' && event.metadata?.text) {
          setLiveNarration(event.metadata.text);
        }
      } catch {
        // ignore malformed/comment lines
      }
    };
    return () => es.close();
  }, [busy]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Web Speech API - browser-native, no backend/key needed. Chrome/Edge only;
  // Firefox and Safari don't implement SpeechRecognition, so we detect and
  // hide the mic button there rather than showing something broken.
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceSupported(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
  }, []);

  const toggleListening = useCallback(() => {
    if (!recognitionRef.current) return;
    if (listening) {
      recognitionRef.current.stop();
      setListening(false);
    } else {
      recognitionRef.current.start();
      setListening(true);
    }
  }, [listening]);

  function handleFileSelect(e) {
    const selected = Array.from(e.target.files || []);
    const errors = [];
    const valid = [];

    for (const file of selected) {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        errors.push(`${file.name}: unsupported file type (images, PDFs, Word, and Excel files only)`);
        continue;
      }
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        errors.push(`${file.name}: over ${MAX_FILE_MB}MB limit`);
        continue;
      }
      valid.push(file);
    }

    if (errors.length) {
      addChatMessage({ role: 'assistant', content: errors.join('\n') });
    }
    setFiles((prev) => [...prev, ...valid]);
    e.target.value = ''; // allow re-selecting the same file
  }

  function removeFile(index) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const text = input.trim();
    if ((!text && files.length === 0) || !connected || busy) return;

    const attachmentNames = files.map((f) => f.name);
    const displayText = text || (attachmentNames.length ? `Sent ${attachmentNames.length === 1 ? attachmentNames[0] : `${attachmentNames.length} files`}` : '');
    addChatMessage({ role: 'user', content: displayText, attachmentNames });
    setInput('');
    const filesToSend = files;
    setFiles([]);
    setBusy(true);

    try {
      const attachments = await Promise.all(
        filesToSend.map(async (file) => ({
          filename: file.name,
          mediaType: file.type,
          data: await fileToBase64(file),
        }))
      );
      const history = chatMessages
        .filter((m) => m.content && m.content.trim().length > 0)
        .map((m) => ({ role: m.role, content: m.content }));
      const result = await api.chat(text, history, attachments);
      addChatMessage({ role: 'assistant', content: result.reply, task: result.task });
    } catch (err) {
      addChatMessage({ role: 'assistant', content: `Something went wrong: ${err.message}` });
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-3.5rem)]">
      <div className="p-6 pb-3">
        <h1 className="font-[var(--font-display)] text-xl font-semibold mb-1">Chat</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Talk normally, attach an image or PDF, or use voice input. Only real requests — send an email, triage the inbox, research something — create a task.
        </p>
      </div>

      {!connected && (
        <div className="mx-6 mb-3 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 p-3 text-xs text-[var(--color-warning)]">
          Backend not reachable — start it at localhost:4000 to chat for real.
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 space-y-3">
        {chatMessages.length === 0 && (
          <div className="text-sm text-[var(--color-text-muted)] py-8 text-center">
            Say hello, ask a question, attach a file, or give it something to do.
          </div>
        )}
        {chatMessages.map((msg, i) => (
          <Bubble key={i} msg={msg} />
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-lg px-3.5 py-2.5 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] flex items-center gap-2">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-accent)] opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-accent)]" />
              </span>
              <span className={liveNarration ? '' : 'text-[var(--color-text-muted)]'}>
                {liveNarration || '…'}
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="px-6 pt-3">
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {files.map((file, i) => (
              <AttachmentChip key={i} file={file} onRemove={() => removeFile(i)} />
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex gap-2 items-end pb-6">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES.join(',')}
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!connected || busy}
            title="Attach image or PDF"
            className="p-2.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)]/40 disabled:opacity-40 transition shrink-0"
          >
            <Paperclip size={16} />
          </button>

          {voiceSupported && (
            <button
              type="button"
              onClick={toggleListening}
              disabled={!connected || busy}
              title={listening ? 'Stop listening' : 'Voice input'}
              className={`p-2.5 rounded-md border transition shrink-0 disabled:opacity-40 ${
                listening
                  ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent-dim)] pulse-live'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)]/40'
              }`}
            >
              {listening ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
          )}

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={listening ? 'Listening…' : 'Message — Enter to send, Shift+Enter for a new line'}
            rows={1}
            className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]/50 resize-none"
          />
          <button
            type="submit"
            disabled={!connected || busy || (!input.trim() && files.length === 0)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-[var(--color-accent)] text-black text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition shrink-0"
          >
            <Send size={14} />
          </button>
        </form>
      </div>
    </div>
  );
}
