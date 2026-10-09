import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, ListChecks, Paperclip, Mic, MicOff, X, FileText, Image as ImageIcon, ChevronDown, ChevronUp, Volume2, VolumeX } from 'lucide-react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore } from '../store/useStore';
import { api } from '../services/api';
import { createResilientEventSource } from '../services/resilientEventSource';
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

const DEPARTMENT_LABELS = {
  sales: 'Sales',
  marketing: 'Marketing',
  support: 'Support',
  strategy: 'Strategy',
  development: 'Development',
};

function toolToLabel(name) {
  const match = /^run_(.+)_task$/.exec(name);
  if (match) return `${DEPARTMENT_LABELS[match[1]] || match[1]} agent`;
  if (name === 'list_pending_approvals') return 'pending approvals';
  if (name === 'check_task_result') return 'task status';
  return name;
}

export default function Chat({ scope = null }) {
  const { connected, chatMessages, addChatMessage, refresh } = useStore();
  const sendMessage = useStore((s) => s.sendMessage);
  const assistantSession = useStore((s) => s.assistant);
  const [input, setInput] = useState('');
  const [files, setFiles] = useState([]);
  const busy = assistantSession.streaming;
  const streamingReply = assistantSession.streamingReply;
  const activeTool = assistantSession.activeTool;
  const setBusy = () => {}; // kept as no-op; busy derives from store now
  const setStreamingReply = () => {};
  const setActiveTool = () => {};
  const [liveNarration, setLiveNarration] = useState(null);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const [voiceMode, setVoiceMode] = useState(() => localStorage.getItem('cc_voice_mode') === 'on');
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const voiceModeRef = useRef(voiceMode);

  useEffect(() => {
    voiceModeRef.current = voiceMode;
    localStorage.setItem('cc_voice_mode', voiceMode ? 'on' : 'off');
  }, [voiceMode]);

  // Pick the most natural available voice once. Chrome ships several neural
  // voices (names contain "Natural", "Online", or "Google"); fall back to
  // the default if none match.
  const voiceChoiceRef = useRef(null);
  useEffect(() => {
    if (!window.speechSynthesis) return;
    const pick = () => {
      const voices = window.speechSynthesis.getVoices();
      if (!voices.length) return;
      const prefer = (v) =>
        /Natural/i.test(v.name) ? 3 :
        /Google (US|UK|British|English)/i.test(v.name) ? 2 :
        /Online/i.test(v.name) ? 2 :
        /en-/i.test(v.lang) ? 1 : 0;
      voiceChoiceRef.current = [...voices].sort((a, b) => prefer(b) - prefer(a))[0];
    };
    pick();
    window.speechSynthesis.onvoiceschanged = pick;
  }, []);

  // Speak the Assistant's final reply, then re-open the mic hands-free.
  // Chrome has a long-standing bug where speech cuts off after ~15s unless
  // you poke resume() periodically - the keepAlive timer below is the fix.
  const speak = useCallback((text, onEnd) => {
    if (!window.speechSynthesis || !text) { onEnd?.(); return; }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    if (voiceChoiceRef.current) utter.voice = voiceChoiceRef.current;
    utter.rate = 1.0;
    utter.pitch = 1.0;
    const keepAlive = setInterval(() => {
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 10000);
    utter.onend = () => { clearInterval(keepAlive); onEnd?.(); };
    utter.onerror = () => { clearInterval(keepAlive); onEnd?.(); };
    window.speechSynthesis.speak(utter);
  }, []);

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
    const conn = createResilientEventSource(
      api.getEventsStreamUrl,
      (msg) => {
        try {
          const event = JSON.parse(msg.data);
          if (event.action === 'narration' && event.metadata?.text) {
            setLiveNarration(event.metadata.text);
          }
        } catch {}
      },
    );
    return () => conn.close();
  }, [busy]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Detect browser support once. Chrome/Edge/Safari implement this; Firefox
  // doesn't. We create a FRESH SpeechRecognition for each listening session
  // (reusing one across turns is where the "breaks after one reply" came
  // from — the instance ends up in a half-closed state, and start() either
  // throws InvalidStateError or just never fires a result).
  const SpeechRecognitionCtor = useRef(null);
  useEffect(() => {
    SpeechRecognitionCtor.current = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    if (!SpeechRecognitionCtor.current) setVoiceSupported(false);
  }, []);

  const startListening = useCallback(() => {
    const Ctor = SpeechRecognitionCtor.current;
    if (!Ctor) return;
    // If a listening session is already live, do nothing - re-entering would
    // just abort it, which cascades through its own onend into another
    // startListening call. Classic feedback loop.
    if (recognitionRef.current) {
      console.log('[voice] startListening skipped - already listening');
      return;
    }

    const rec = new Ctor();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = 'en-US';
    let gotResult = false;

    rec.onresult = (e) => {
      gotResult = true;
      const transcript = e.results[0][0].transcript;
      console.log('[voice] heard:', transcript);
      if (voiceModeRef.current) {
        setInput('');
        submitText(transcript);
      } else {
        setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
      }
    };

    rec.onend = () => {
      // Only act if this rec is STILL the current one. If something else
      // replaced it (abort, toggle off), ignore - that path owns the state.
      if (recognitionRef.current !== rec) return;
      recognitionRef.current = null;
      console.log('[voice] rec ended, gotResult=', gotResult, 'voiceMode=', voiceModeRef.current, 'busy=', busyRef.current);
      setListening(false);
      // Only re-arm if voice mode is still on, we didn't just submit (gotResult=true
      // means submitText is now running and will reopen the mic after TTS),
      // and we're not currently processing a reply.
      if (voiceModeRef.current && !gotResult && !busyRef.current) {
        setTimeout(() => { if (voiceModeRef.current && !busyRef.current && !recognitionRef.current) startListening(); }, 400);
      }
    };

    rec.onerror = (e) => {
      if (recognitionRef.current !== rec) return;
      console.warn('[voice] rec error:', e.error);
      // Expected transient errors - let onend handle the re-arm.
      // Fatal errors (not-allowed, service-not-allowed): turn voice mode off.
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        voiceModeRef.current = false;
        setVoiceMode(false);
        setListening(false);
      }
    };

    try {
      rec.start();
      recognitionRef.current = rec;
      setListening(true);
      console.log('[voice] listening…');
    } catch (err) {
      console.warn('[voice] start() threw:', err.message);
      // Engine still winding down. Retry once after a longer pause.
      setTimeout(() => { if (voiceModeRef.current && !busyRef.current && !recognitionRef.current) startListening(); }, 500);
    }
  }, []);

  // Safely abort the current recognition without triggering a re-arm.
  const stopListening = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    recognitionRef.current = null; // detach so onend knows this rec is dead
    try { rec.onresult = null; rec.onend = null; rec.onerror = null; } catch {}
    try { rec.abort(); } catch {}
    setListening(false);
  }, []);

  const toggleListening = useCallback(() => {
    if (listening) stopListening();
    else startListening();
  }, [listening, startListening, stopListening]);

  const restartMic = useCallback(() => {
    if (!voiceModeRef.current) return;
    // Fresh start - make sure nothing is lingering first.
    stopListening();
    setTimeout(() => { if (voiceModeRef.current) startListening(); }, 150);
  }, [startListening, stopListening]);

  // Track busy state in a ref so the recognition callbacks (set up once per
  // listen) can see the current value without being torn down and recreated.
  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  const toggleVoiceMode = useCallback(() => {
    setVoiceMode((on) => {
      const next = !on;
      voiceModeRef.current = next;
      if (!next) {
        // Turning OFF: stop any in-progress speech + mic immediately.
        try { window.speechSynthesis?.cancel(); } catch {}
        stopListening();
      } else {
        // Turning ON: start listening right away so the user can just talk.
        startListening();
      }
      return next;
    });
  }, [startListening, stopListening]);

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
    await submitText(input.trim());
  }

  async function submitText(rawText) {
    const text = (rawText || '').trim();
    if ((!text && files.length === 0) || !connected || busy) return;

    const filesToSend = files;
    setInput('');
    setFiles([]);

    const attachments = await Promise.all(
      filesToSend.map(async (file) => ({
        filename: file.name,
        mediaType: file.type,
        data: await fileToBase64(file),
        name: file.name,
      }))
    );

    const result = await sendMessage({
      text,
      scope,
      voice: voiceModeRef.current,
      attachments,
    });

    busyRef.current = false;
    if (voiceModeRef.current && result?.accumulated) {
      const spoken = stripMarkdown(result.accumulated);
      console.log('[voice] speaking reply, length=', spoken.length);
      speak(spoken, () => {
        console.log('[voice] TTS ended, restarting mic');
        restartMic();
      });
    }
  }

  function stripMarkdown(text) {
    return text
      .replace(/```[\s\S]*?```/g, ' code block ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/^#+\s*/gm, '')
      .replace(/^\s*[-*]\s+/gm, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  return (
    <div className="flex flex-col h-full max-h-[calc(100dvh-3.5rem)] min-w-0">
      <div className="p-4 md:p-6 pb-2 md:pb-3">
        <h1 className="font-[var(--font-display)] text-xl font-semibold mb-1">
          {scope ? `${DEPARTMENT_LABELS[scope] || scope} Assistant` : 'Assistant'}
        </h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          {scope
            ? `Chat with the ${DEPARTMENT_LABELS[scope] || scope} department. Ask follow-ups, chain steps, approve drafts before anything sends.`
            : 'Talk normally, attach an image or PDF, or use voice input. The Assistant chains agents when needed; irreversible actions wait for your approval.'}
        </p>
      </div>

      {!connected && (
        <div className="mx-4 md:mx-6 mb-3 rounded-lg border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 p-3 text-xs text-[var(--color-warning)]">
          Backend not reachable — start it at localhost:4000 to chat for real.
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 md:px-6 space-y-3">
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
            <div className="max-w-[80%] rounded-lg px-3.5 py-2.5 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)]">
              {activeTool && (
                <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] mb-1.5">
                  <span className="relative flex h-1.5 w-1.5 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-accent)] opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
                  </span>
                  Running {activeTool}…
                </div>
              )}
              {streamingReply ? (
                <div className="prose-codecraft prose prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingReply}</ReactMarkdown>
                </div>
              ) : !activeTool ? (
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-accent)] opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-accent)]" />
                  </span>
                  <span className="text-[var(--color-text-muted)]">{liveNarration || '…'}</span>
                </div>
              ) : null}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="px-4 md:px-6 pt-3">
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {files.map((file, i) => (
              <AttachmentChip key={i} file={file} onRemove={() => removeFile(i)} />
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex gap-2 items-end pb-4 md:pb-6">
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
            <>
              <button
                type="button"
                onClick={toggleVoiceMode}
                disabled={!connected}
                title={voiceMode ? 'Turn off hands-free voice mode' : 'Turn on hands-free voice mode (I\'ll listen, reply out loud, and listen again)'}
                className={`p-2.5 rounded-md border transition shrink-0 disabled:opacity-40 ${
                  voiceMode
                    ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent-dim)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)]/40'
                }`}
              >
                {voiceMode ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>
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
            </>
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
