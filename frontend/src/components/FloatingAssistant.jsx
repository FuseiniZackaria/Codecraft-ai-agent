import { useEffect, useRef, useState, useCallback } from 'react';
import { useLocation, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X, Minus, Send, Mic, MicOff, Volume2, VolumeX, Settings as SettingsIcon, ListChecks, MessageCircle } from 'lucide-react';
import { useStore } from '../store/useStore';
import { matchNameTrigger } from '../services/nameTrigger';
import StatusPill from './StatusPill';

const CORNERS = {
  br: { bottom: 20, right: 20, align: 'end' },
  bl: { bottom: 20, left: 20, align: 'start' },
  tr: { top: 70, right: 20, align: 'end' },
  tl: { top: 70, left: 20, align: 'start' },
};

function PanelMessage({ msg, tasks }) {
  const isUser = msg.role === 'user';
  const liveTask = msg.task ? tasks.find((t) => t.id === msg.task.id) || msg.task : null;
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? 'bg-[var(--color-accent)] text-black'
            : 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)]'
        }`}
      >
        {msg.content && (
          <div className={`${isUser ? '' : 'prose-codecraft'} prose prose-sm max-w-none`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
          </div>
        )}
        {liveTask && (
          <Link
            to="/tasks"
            className={`mt-2 flex items-center gap-1.5 text-[11px] pt-1.5 border-t ${
              isUser ? 'border-black/20 text-black/70' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
            } hover:underline w-fit`}
          >
            <ListChecks size={11} />
            <span className="truncate max-w-[220px]">{liveTask.instruction}</span>
            <StatusPill status={liveTask.status} />
          </Link>
        )}
      </div>
    </div>
  );
}

export default function FloatingAssistant() {
  const location = useLocation();
  const chatMessages = useStore((s) => s.chatMessages);
  const tasks = useStore((s) => s.tasks);
  const assistant = useStore((s) => s.assistant);
  const connected = useStore((s) => s.connected);
  const sendMessage = useStore((s) => s.sendMessage);
  const setAssistant = useStore((s) => s.setAssistant);
  const setTriggerMode = useStore((s) => s.setTriggerMode);
  const setSpokenReplies = useStore((s) => s.setSpokenReplies);
  const setCorner = useStore((s) => s.setCorner);

  const [input, setInput] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(true);
  const bottomRef = useRef(null);
  const panelRef = useRef(null);
  const recRef = useRef(null);
  const voiceModeRef = useRef(assistant.voiceMode);
  const streamingRef = useRef(assistant.streaming);
  const silenceTimerRef = useRef(null);

  useEffect(() => { voiceModeRef.current = assistant.voiceMode; }, [assistant.voiceMode]);
  useEffect(() => { streamingRef.current = assistant.streaming; }, [assistant.streaming]);

  // Scope from current route: /departments/:deptKey/... -> scope: deptKey
  const scope = (() => {
    const m = /^\/departments\/([^/]+)/.exec(location.pathname);
    return m ? m[1] : null;
  })();

  // Keyboard: Ctrl+/ toggles the panel.
  useEffect(() => {
    function onKey(e) {
      if (e.ctrlKey && e.key === '/') {
        e.preventDefault();
        setAssistant({ panelOpen: !useStore.getState().assistant.panelOpen });
      } else if (e.key === 'Escape' && useStore.getState().assistant.panelOpen) {
        setAssistant({ panelOpen: false });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setAssistant]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, assistant.streamingReply, assistant.panelOpen]);

  // Detect speech-recognition support once.
  useEffect(() => {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) setVoiceSupported(false);
  }, []);

  // Trigger-match wrapper around sendMessage - the ignored path never
  // touches the API, so ignored messages cost zero.
  const trySend = useCallback(async (rawText, { fromVoice = false } = {}) => {
    const effectiveMode = fromVoice ? 'name' : assistant.triggerMode;
    const text = (rawText || '').trim();
    if (!text) return;

    let toSend = text;
    if (effectiveMode === 'name') {
      const { matched, stripped } = matchNameTrigger(text, assistant.nameVariations);
      if (!matched) {
        setAssistant({ ignoredHint: `Say "${assistant.name}" to get my attention.` });
        setTimeout(() => {
          if (useStore.getState().assistant.ignoredHint) setAssistant({ ignoredHint: null });
        }, 3500);
        return;
      }
      toSend = stripped || `(no instruction after "${assistant.name}")`;
    }

    setInput('');
    const result = await sendMessage({ text: toSend, scope, voice: fromVoice });

    // TTS the reply if enabled.
    const spoken = useStore.getState().assistant.spokenReplies || fromVoice;
    if (spoken && result?.accumulated && window.speechSynthesis) {
      const clean = result.accumulated
        .replace(/```[\s\S]*?```/g, ' code block ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/^#+\s*/gm, '')
        .replace(/^\s*[-*]\s+/gm, '');
      const utter = new SpeechSynthesisUtterance(clean);
      utter.rate = 1.0;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    }
  }, [assistant.triggerMode, assistant.nameVariations, assistant.name, scope, sendMessage, setAssistant]);

  // --- Voice mode: continuous listening for the trigger word ---
  const startListening = useCallback(() => {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return;
    if (recRef.current) return; // already listening
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onresult = (e) => {
      // Reset the 2-min silence timer on any speech activity.
      resetSilenceTimer();
      // Only process the latest final result.
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          const transcript = e.results[i][0].transcript;
          trySend(transcript, { fromVoice: true });
        }
      }
    };
    rec.onend = () => {
      if (recRef.current !== rec) return;
      recRef.current = null;
      setAssistant({ listening: false });
      // Auto-restart while voice mode is on and we're not currently streaming.
      if (voiceModeRef.current && !streamingRef.current) {
        setTimeout(() => { if (voiceModeRef.current && !recRef.current && !streamingRef.current) startListening(); }, 300);
      }
    };
    rec.onerror = (ev) => {
      if (recRef.current !== rec) return;
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        voiceModeRef.current = false;
        setAssistant({ voiceMode: false, listening: false });
      }
    };

    try {
      rec.start();
      recRef.current = rec;
      setAssistant({ listening: true });
    } catch {
      setTimeout(() => { if (voiceModeRef.current && !recRef.current) startListening(); }, 500);
    }
  }, [trySend, setAssistant]);

  const stopListening = useCallback(() => {
    const rec = recRef.current;
    recRef.current = null;
    if (rec) {
      try { rec.onresult = null; rec.onend = null; rec.onerror = null; rec.abort(); } catch {}
    }
    setAssistant({ listening: false });
  }, [setAssistant]);

  const resetSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
      // 2 minutes of no final transcript - turn voice mode off.
      voiceModeRef.current = false;
      setAssistant({ voiceMode: false });
      stopListening();
    }, 2 * 60 * 1000);
  }, [setAssistant, stopListening]);

  // Toggle voice mode (never listens without this click).
  const toggleVoice = useCallback(() => {
    const next = !voiceModeRef.current;
    voiceModeRef.current = next;
    setAssistant({ voiceMode: next });
    if (next) {
      resetSilenceTimer();
      startListening();
    } else {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      stopListening();
    }
  }, [setAssistant, startListening, stopListening, resetSilenceTimer]);

  // Turn off voice when the panel closes.
  useEffect(() => {
    if (!assistant.panelOpen && voiceModeRef.current) {
      voiceModeRef.current = false;
      setAssistant({ voiceMode: false });
      stopListening();
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    }
  }, [assistant.panelOpen, setAssistant, stopListening]);

  // Clean up on unmount.
  useEffect(() => () => {
    stopListening();
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
  }, [stopListening]);

  // --- Drag + corner snap ---
  const dragStateRef = useRef(null);
  function onHeaderMouseDown(e) {
    if (e.target.closest('button')) return;
    dragStateRef.current = { startX: e.clientX, startY: e.clientY, moved: false };
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
  }
  function onDragMove(e) {
    const d = dragStateRef.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 6) d.moved = true;
    if (panelRef.current && d.moved) {
      panelRef.current.style.transform = `translate(${e.clientX - d.startX}px, ${e.clientY - d.startY}px)`;
    }
  }
  function onDragEnd(e) {
    const d = dragStateRef.current;
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', onDragEnd);
    dragStateRef.current = null;
    if (panelRef.current) panelRef.current.style.transform = '';
    if (!d || !d.moved) return;
    const cx = e.clientX, cy = e.clientY;
    const half = { w: window.innerWidth / 2, h: window.innerHeight / 2 };
    const corner = `${cy < half.h ? 't' : 'b'}${cx < half.w ? 'l' : 'r'}`;
    setCorner(corner);
  }

  const pos = CORNERS[assistant.corner] || CORNERS.br;
  const sorted = [...chatMessages];

  // The FAB sits in the SAME corner as the panel, so when the panel opens
  // it visually "grows from" the button. On mobile we fullscreen the panel.
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

  const statusColor =
    assistant.streaming ? 'bg-amber-400 animate-pulse' :
    assistant.listening ? 'bg-green-400 animate-pulse' :
    'bg-[var(--color-text-muted)]/50';

  return (
    <>
      {/* Floating action button */}
      {!assistant.panelOpen && (
        <button
          onClick={() => setAssistant({ panelOpen: true })}
          style={pos}
          className="fixed z-40 w-14 h-14 rounded-full bg-[var(--color-accent)] text-black shadow-lg hover:brightness-110 flex items-center justify-center transition-all"
          aria-label={`Open ${assistant.name}`}
          title={`${assistant.name} (Ctrl+/)`}
        >
          <span className="font-[var(--font-display)] font-bold text-lg">{assistant.name.charAt(0)}</span>
          <span className={`absolute bottom-1 right-1 w-3 h-3 rounded-full border-2 border-[var(--color-accent)] ${statusColor}`} />
        </button>
      )}

      {/* Panel */}
      {assistant.panelOpen && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={`${assistant.name} assistant`}
          style={isMobile ? { top: 0, left: 0, right: 0, bottom: 0 } : pos}
          className={`fixed z-40 flex flex-col bg-[var(--color-bg)] border border-[var(--color-border)] shadow-2xl ${
            isMobile ? '' : 'w-[380px] h-[560px] rounded-xl overflow-hidden'
          }`}
        >
          {/* Header */}
          <div
            onMouseDown={onHeaderMouseDown}
            className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface)] cursor-move select-none"
          >
            <div className="w-7 h-7 rounded-full bg-[var(--color-accent)] text-black flex items-center justify-center font-[var(--font-display)] font-bold text-sm">
              {assistant.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium leading-tight">{assistant.name}</div>
              <div className="text-[11px] text-[var(--color-text-muted)] leading-tight flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
                {assistant.streaming ? 'thinking…' : assistant.listening ? 'listening…' : scope ? `${scope} scope` : 'idle'}
              </div>
            </div>
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              aria-label="Settings"
              className="p-1.5 rounded hover:bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <SettingsIcon size={14} />
            </button>
            <Link
              to="/chat"
              aria-label="Open full chat"
              title="Open full chat"
              className="p-1.5 rounded hover:bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <MessageCircle size={14} />
            </Link>
            <button
              onClick={() => setAssistant({ panelOpen: false })}
              aria-label="Minimise"
              className="p-1.5 rounded hover:bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <Minus size={14} />
            </button>
            <button
              onClick={() => setAssistant({ panelOpen: false })}
              aria-label="Close"
              className="p-1.5 rounded hover:bg-[var(--color-surface-2)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <X size={14} />
            </button>
          </div>

          {/* Settings drawer */}
          {settingsOpen && (
            <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]/60 px-3 py-2.5 space-y-2 text-xs">
              <div>
                <div className="text-[var(--color-text-muted)] mb-1">Respond to</div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setTriggerMode('every')}
                    className={`flex-1 px-2 py-1 rounded border text-xs ${
                      assistant.triggerMode === 'every'
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                        : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                    }`}
                  >
                    Every message I type
                  </button>
                  <button
                    onClick={() => setTriggerMode('name')}
                    className={`flex-1 px-2 py-1 rounded border text-xs ${
                      assistant.triggerMode === 'name'
                        ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                        : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                    }`}
                  >
                    Only when I say {assistant.name}
                  </button>
                </div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={assistant.spokenReplies}
                  onChange={(e) => setSpokenReplies(e.target.checked)}
                  className="accent-[var(--color-accent)]"
                />
                <span>Speak replies out loud</span>
              </label>
              {!voiceSupported && (
                <div className="text-[var(--color-text-muted)] text-[11px]">
                  Voice input needs Chrome, Edge, or Safari.
                </div>
              )}
            </div>
          )}

          {/* Messages */}
          <div
            className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5"
            aria-live="polite"
            aria-atomic="false"
          >
            {sorted.length === 0 && (
              <div className="text-xs text-[var(--color-text-muted)] py-6 text-center">
                Say hi, ask a question, or give me something to do.
                <div className="mt-1 text-[10px]">Ctrl+/ to toggle.</div>
              </div>
            )}
            {sorted.map((msg, i) => <PanelMessage key={i} msg={msg} tasks={tasks} />)}
            {assistant.streaming && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-[var(--color-surface)] border border-[var(--color-border)]">
                  {assistant.activeTool && (
                    <div className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-muted)] mb-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
                      Running {assistant.activeTool.replace(/^run_|_task$/g, '').replace(/_/g, ' ')}…
                    </div>
                  )}
                  {assistant.streamingReply ? (
                    <div className="prose-codecraft prose prose-sm max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{assistant.streamingReply}</ReactMarkdown>
                    </div>
                  ) : !assistant.activeTool ? (
                    <span className="text-[var(--color-text-muted)]">…</span>
                  ) : null}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Ignored hint */}
          {assistant.ignoredHint && (
            <div className="px-3 py-1.5 text-[11px] text-[var(--color-text-muted)] bg-[var(--color-surface-2)]/40 border-t border-[var(--color-border)]">
              {assistant.ignoredHint}
            </div>
          )}

          {/* Input */}
          <form
            onSubmit={(e) => { e.preventDefault(); trySend(input); }}
            className="flex items-end gap-1.5 px-2.5 py-2 border-t border-[var(--color-border)]"
          >
            {voiceSupported && (
              <button
                type="button"
                onClick={toggleVoice}
                disabled={!connected}
                title={assistant.voiceMode ? 'Turn voice off' : 'Turn voice on (listens for your name)'}
                aria-label={assistant.voiceMode ? 'Turn voice off' : 'Turn voice on'}
                className={`p-2 rounded-md border shrink-0 ${
                  assistant.voiceMode
                    ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent)]/10'
                    : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                }`}
              >
                {assistant.voiceMode ? <Mic size={14} /> : <MicOff size={14} />}
              </button>
            )}
            <button
              type="button"
              onClick={() => setSpokenReplies(!assistant.spokenReplies)}
              title={assistant.spokenReplies ? 'Mute spoken replies' : 'Enable spoken replies'}
              aria-label={assistant.spokenReplies ? 'Mute spoken replies' : 'Enable spoken replies'}
              className={`p-2 rounded-md border shrink-0 ${
                assistant.spokenReplies
                  ? 'border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-accent)]/10'
                  : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {assistant.spokenReplies ? <Volume2 size={14} /> : <VolumeX size={14} />}
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  trySend(input);
                }
              }}
              rows={1}
              placeholder={
                assistant.triggerMode === 'name'
                  ? `${assistant.name}, ...`
                  : 'Message'
              }
              disabled={!connected || assistant.streaming}
              className="flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]/50 resize-none max-h-24"
            />
            <button
              type="submit"
              disabled={!connected || !input.trim() || assistant.streaming}
              aria-label="Send"
              className="p-2 rounded-md bg-[var(--color-accent)] text-black shrink-0 disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
            >
              <Send size={14} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
