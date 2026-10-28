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

const PAUSE_MS = 1500; // silence after speech that ends one voice message
const MAX_VOICE_RESTARTS = 5; // failed restarts in a row before the mic gives up

// Friendly text for SpeechRecognition error codes.
const VOICE_ERRORS = {
  'not-allowed': 'Microphone blocked. Allow it in your browser\'s site settings, then click the mic.',
  'service-not-allowed': 'Your browser doesn\'t allow speech recognition here. Try Chrome or Edge, or check its settings.',
  'audio-capture': 'No microphone found. Plug one in or check your sound settings. Retrying…',
  network: 'Voice recognition lost its connection. Retrying…',
  'language-not-supported': 'Voice input isn\'t available for this language in your browser.',
  'bad-grammar': 'Voice input isn\'t available in this browser.',
};
const FATAL_VOICE_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'language-not-supported', 'bad-grammar']);

const wordsOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);

// True when most of what the mic heard is words Ian is saying (or just said).
function isEcho(heard, spoken) {
  const words = wordsOf(heard);
  if (!words.length) return true;
  const said = new Set(wordsOf(spoken));
  if (!said.size) return false;
  return words.filter((w) => said.has(w)).length / words.length >= 0.6;
}

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
  const silenceTimerRef = useRef(null);

  useEffect(() => { voiceModeRef.current = assistant.voiceMode; }, [assistant.voiceMode]);

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

  // --- Voice: continuous conversation (no name needed) ---
  // One SpeechRecognition session at a time (recRef). Final results are
  // collected and sent as one message after a 1.5s pause; interim text is only
  // shown, never sent. The mic stays on while Ian speaks so you can interrupt,
  // and anything that matches his own words is ignored as echo.
  const [speaking, setSpeaking] = useState(false);
  const [voiceError, setVoiceError] = useState(null);
  const [heard, setHeard] = useState(''); // live transcript, display only
  const speakingRef = useRef(false);
  const speakTokenRef = useRef(0);
  const spokenTextRef = useRef('');
  const echoUntilRef = useRef(0);
  const bufferRef = useRef(''); // final results not sent yet
  const interimRef = useRef('');
  const lastSpeechAtRef = useRef(0);
  const pauseTimerRef = useRef(null);
  const restartTimerRef = useRef(null);
  const failuresRef = useRef(0);
  const trySendRef = useRef(null);
  const voiceOffRef = useRef(null);

  function stopSpeaking() {
    speakTokenRef.current += 1;
    try { window.speechSynthesis?.cancel(); } catch {}
    if (speakingRef.current) echoUntilRef.current = Date.now() + 1500;
    speakingRef.current = false;
    setSpeaking(false);
  }

  function speak(text) {
    if (!window.speechSynthesis || !text) return;
    const clean = text
      .replace(/```[\s\S]*?```/g, ' code block ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^#+\s*/gm, '')
      .replace(/^\s*[-*]\s+/gm, '');
    stopSpeaking();
    const token = speakTokenRef.current;
    const utter = new SpeechSynthesisUtterance(clean);
    utter.rate = 1.0;
    spokenTextRef.current = clean;
    speakingRef.current = true;
    setSpeaking(true);
    // Chrome cuts long utterances off after ~15s unless nudged.
    const keepAlive = setInterval(() => {
      if (window.speechSynthesis.speaking) { window.speechSynthesis.pause(); window.speechSynthesis.resume(); }
    }, 10000);
    const done = () => {
      clearInterval(keepAlive);
      if (token !== speakTokenRef.current) return; // replaced or cancelled
      speakingRef.current = false;
      setSpeaking(false);
      echoUntilRef.current = Date.now() + 1500; // late echo can still arrive
      if (voiceModeRef.current) resetSilenceTimer();
    };
    utter.onend = done;
    utter.onerror = done;
    window.speechSynthesis.speak(utter);
  }

  // Typed messages follow the "Respond to" setting; voice never needs the name.
  const trySend = useCallback(async (rawText, { fromVoice = false } = {}) => {
    const text = (rawText || '').trim();
    if (!text) return;

    let toSend = text;
    if (!fromVoice && assistant.triggerMode === 'name') {
      // The ignored path never touches the API, so ignored messages cost zero.
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

    if (!fromVoice) setInput('');
    const result = await sendMessage({ text: toSend, scope, voice: fromVoice });

    // Don't read out an answer you've already started talking over.
    if (useStore.getState().assistant.spokenReplies && result?.accumulated && !bufferRef.current) {
      speak(result.accumulated);
    }
    if (voiceModeRef.current) resetSilenceTimer();
  }, [assistant.triggerMode, assistant.nameVariations, assistant.name, scope, sendMessage, setAssistant]);
  trySendRef.current = trySend;

  function resetSilenceTimer() {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
      setVoiceError('Mic turned off after 2 minutes of silence. Click the mic to talk again.');
      turnVoiceOff();
    }, 2 * 60 * 1000);
  }

  function schedulePauseFlush() {
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current);
    const wait = Math.max(200, lastSpeechAtRef.current + PAUSE_MS - Date.now());
    pauseTimerRef.current = setTimeout(flushVoice, wait);
  }

  function flushVoice() {
    pauseTimerRef.current = null;
    const text = bufferRef.current.trim();
    if (!text) {
      // Words heard but not finalised yet - give the browser a moment.
      if (interimRef.current && Date.now() - lastSpeechAtRef.current < 4000) {
        pauseTimerRef.current = setTimeout(flushVoice, 400);
      } else {
        interimRef.current = '';
        setHeard('');
      }
      return;
    }
    // Ian is still answering the last message - send this one right after.
    if (useStore.getState().assistant.streaming) {
      pauseTimerRef.current = setTimeout(flushVoice, 400);
      return;
    }
    bufferRef.current = '';
    interimRef.current = '';
    setHeard('');
    if (wordsOf(text).length < 2) return; // one-word noise
    trySendRef.current?.(text, { fromVoice: true });
  }

  function startRecognition() {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor || recRef.current || !voiceModeRef.current) return;
    if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true; // for pause detection + interruption; never sent
    rec.lang = 'en-US';
    let started = false;
    let failed = false;

    rec.onstart = () => {
      if (recRef.current !== rec) return;
      started = true;
      setAssistant({ listening: true });
    };

    rec.onresult = (e) => {
      if (recRef.current !== rec) return;
      let finalText = '';
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += ` ${t}`;
        else interim += ` ${t}`;
      }
      finalText = finalText.trim();
      interim = interim.trim();
      const now = `${finalText} ${interim}`.trim();
      if (!now) return;

      // Ian's own voice coming back through the speakers - drop it.
      const echoWindow = speakingRef.current || Date.now() < echoUntilRef.current;
      if (echoWindow && isEcho(now, spokenTextRef.current)) return;
      if (speakingRef.current) {
        if (wordsOf(now).length < 2) return;
        stopSpeaking(); // you talked over Ian: stop him and listen
      }

      failuresRef.current = 0;
      setVoiceError(null);
      resetSilenceTimer();
      if (interim) lastSpeechAtRef.current = Date.now();
      else if (!lastSpeechAtRef.current) lastSpeechAtRef.current = Date.now();
      if (finalText) bufferRef.current = `${bufferRef.current} ${finalText}`.trim();
      interimRef.current = interim;
      setHeard(`${bufferRef.current} ${interim}`.trim());
      schedulePauseFlush();
    };

    rec.onerror = (e) => {
      if (recRef.current !== rec) return;
      // The browser stops after silence ("no-speech") or on its own ("aborted"); onend restarts.
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      const message = VOICE_ERRORS[e.error] || `Voice input hit a problem (${e.error}). Retrying…`;
      setVoiceError(message);
      if (FATAL_VOICE_ERRORS.has(e.error)) { turnVoiceOff(); return; }
      failed = true;
    };

    rec.onend = () => {
      if (recRef.current !== rec) return;
      recRef.current = null;
      if (!voiceModeRef.current) { setAssistant({ listening: false }); return; }
      failuresRef.current = started && !failed ? 0 : failuresRef.current + 1;
      if (failuresRef.current >= MAX_VOICE_RESTARTS) {
        setVoiceError('Voice input keeps stopping, so I turned the mic off. Click the mic to try again.');
        turnVoiceOff();
        return;
      }
      restartTimerRef.current = setTimeout(startRecognition, 250 * (failuresRef.current + 1));
    };

    try {
      rec.start();
      recRef.current = rec;
    } catch (err) {
      failuresRef.current += 1;
      if (failuresRef.current >= MAX_VOICE_RESTARTS) {
        setVoiceError(`Couldn't start the microphone (${err.message}). Click the mic to try again.`);
        turnVoiceOff();
      } else {
        restartTimerRef.current = setTimeout(startRecognition, 500 * failuresRef.current);
      }
    }
  }

  // Ends the session and every timer. Safe to call any number of times.
  function stopRecognition() {
    for (const ref of [restartTimerRef, pauseTimerRef, silenceTimerRef]) {
      if (ref.current) clearTimeout(ref.current);
      ref.current = null;
    }
    bufferRef.current = '';
    interimRef.current = '';
    lastSpeechAtRef.current = 0;
    setHeard('');
    const rec = recRef.current;
    recRef.current = null;
    if (rec) {
      try { rec.onstart = null; rec.onresult = null; rec.onend = null; rec.onerror = null; rec.abort(); } catch {}
    }
  }

  function turnVoiceOff() {
    voiceModeRef.current = false;
    setAssistant({ voiceMode: false, listening: false });
    stopRecognition();
  }
  voiceOffRef.current = turnVoiceOff;

  // Toggle voice mode (never listens without this click).
  function toggleVoice() {
    if (voiceModeRef.current) {
      setVoiceError(null);
      turnVoiceOff();
      return;
    }
    setVoiceError(null);
    failuresRef.current = 0;
    voiceModeRef.current = true;
    setAssistant({ voiceMode: true });
    resetSilenceTimer();
    startRecognition();
  }

  // Turn off voice (and any speech) when the panel closes.
  useEffect(() => {
    if (!assistant.panelOpen) {
      if (voiceModeRef.current || recRef.current) voiceOffRef.current();
      if (speakingRef.current) stopSpeaking();
    }
  }, [assistant.panelOpen]);

  // Clean up on unmount and when the page is closed or reloaded.
  useEffect(() => {
    const onLeave = () => {
      voiceOffRef.current?.();
      try { window.speechSynthesis?.cancel(); } catch {}
    };
    window.addEventListener('pagehide', onLeave);
    return () => {
      window.removeEventListener('pagehide', onLeave);
      onLeave();
    };
  }, []);

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

  const voiceState = speaking ? 'speaking' : assistant.streaming ? 'thinking' : assistant.listening ? 'listening' : 'idle';
  const statusColor = {
    speaking: 'bg-sky-400 animate-pulse',
    thinking: 'bg-amber-400 animate-pulse',
    listening: 'bg-green-400 animate-pulse',
    idle: 'bg-[var(--color-text-muted)]/50',
  }[voiceState];
  const hint = voiceError || (heard ? `🎙 ${heard}` : assistant.ignoredHint);

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
                {voiceState !== 'idle' ? `${voiceState}…` : scope ? `${scope} scope` : 'idle'}
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

          {/* Voice error / live transcript / ignored hint */}
          {hint && (
            <div
              role={voiceError ? 'alert' : undefined}
              className={`px-3 py-1.5 text-[11px] bg-[var(--color-surface-2)]/40 border-t border-[var(--color-border)] ${
                voiceError ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-muted)]'
              }`}
            >
              {hint}
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
                title={assistant.voiceMode ? 'Turn voice off' : 'Turn voice on (everything you say goes to me)'}
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
              onClick={() => {
                if (assistant.spokenReplies) stopSpeaking();
                setSpokenReplies(!assistant.spokenReplies);
              }}
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
