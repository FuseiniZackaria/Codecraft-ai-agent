import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, Bot, ListChecks, Puzzle, MessageSquare, Workflow, Send, Search, Terminal, Package } from 'lucide-react';
import { useStore } from '../store/useStore';

const actions = [
  { label: 'Go to Overview', path: '/', icon: LayoutDashboard },
  { label: 'Go to Agents', path: '/agents', icon: Bot },
  { label: 'Go to Console', path: '/console', icon: Terminal },
  { label: 'Go to Skills', path: '/skills', icon: Package },
  { label: 'Go to Tasks', path: '/tasks', icon: ListChecks },
  { label: 'Go to Research', path: '/research', icon: Search },
  { label: 'Go to Workflows', path: '/workflows', icon: Workflow },
  { label: 'Go to Plugins', path: '/plugins', icon: Puzzle },
  { label: 'Go to Chat', path: '/chat', icon: MessageSquare },
];

export default function CommandPalette() {
  const { paletteOpen, setPaletteOpen, submitGoal, connected } = useStore();
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      }
      if (e.key === 'Escape') setPaletteOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, setPaletteOpen]);

  useEffect(() => {
    if (paletteOpen) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [paletteOpen]);

  if (!paletteOpen) return null;

  const filtered = actions.filter((a) => a.label.toLowerCase().includes(query.toLowerCase()));
  const isGoal = query.trim().length > 0;

  async function handleGoalSubmit() {
    if (!connected) {
      setPaletteOpen(false);
      navigate('/chat');
      return;
    }
    await submitGoal(query.trim());
    setPaletteOpen(false);
    navigate('/tasks');
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm"
      onClick={() => setPaletteOpen(false)}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/90 backdrop-blur-md shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 border-b border-[var(--color-border)]">
          <Send size={14} className="text-[var(--color-text-muted)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && isGoal) handleGoalSubmit();
            }}
            placeholder="Give the AI a goal, or search actions…"
            className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-[var(--color-text-muted)]"
          />
        </div>

        <div className="max-h-72 overflow-y-auto py-2">
          {isGoal && (
            <button
              onClick={handleGoalSubmit}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-[var(--color-surface-2)] transition-colors"
            >
              <Send size={15} className="text-[var(--color-accent)]" />
              Submit goal: <span className="text-[var(--color-text-muted)] truncate">"{query}"</span>
            </button>
          )}
          {filtered.map(({ label, path, icon: Icon }) => (
            <button
              key={path}
              onClick={() => {
                navigate(path);
                setPaletteOpen(false);
              }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-[var(--color-surface-2)] transition-colors"
            >
              <Icon size={15} className="text-[var(--color-text-muted)]" />
              {label}
            </button>
          ))}
          {filtered.length === 0 && !isGoal && (
            <div className="px-4 py-6 text-sm text-[var(--color-text-muted)] text-center">No matches</div>
          )}
        </div>
      </div>
    </div>
  );
}
