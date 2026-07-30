import { useState } from 'react';
import { Search, Globe, ChevronDown } from 'lucide-react';
import { useStore } from '../store/useStore';
import ResultStep from '../components/ResultStep';

function ResearchCard({ task }) {
  const [open, setOpen] = useState(null); // 'sources' | 'analysis' | null
  const steps = task.result || [];
  const searchStep = steps.find((s) => s.results && Array.isArray(s.results));
  const textSteps = steps.filter((s) => s.text);
  const bottomLine = textSteps[textSteps.length - 1];
  const analysisSteps = textSteps.slice(0, -1);

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="font-[var(--font-display)] font-semibold text-sm leading-snug">{task.instruction}</h3>
        {searchStep && (
          <span className="shrink-0 flex items-center gap-1 text-[10px] text-[var(--color-accent)] bg-[var(--color-accent-dim)] px-1.5 py-0.5 rounded font-[var(--font-mono)]">
            <Globe size={10} /> live search
          </span>
        )}
      </div>

      {bottomLine && (
        <div className="prose-codecraft prose prose-sm max-w-none mb-3">
          <ResultStep step={bottomLine} />
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-xs">
        {searchStep && (
          <button
            onClick={() => setOpen(open === 'sources' ? null : 'sources')}
            className="flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)]/40 transition-colors"
          >
            Sources ({searchStep.results.length})
            <ChevronDown size={12} className={open === 'sources' ? 'rotate-180 transition-transform' : 'transition-transform'} />
          </button>
        )}
        {analysisSteps.length > 0 && (
          <button
            onClick={() => setOpen(open === 'analysis' ? null : 'analysis')}
            className="flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)]/40 transition-colors"
          >
            Full analysis
            <ChevronDown size={12} className={open === 'analysis' ? 'rotate-180 transition-transform' : 'transition-transform'} />
          </button>
        )}
        <span className="ml-auto text-[var(--color-text-muted)] font-[var(--font-mono)] self-center">
          {new Date(task.created_at).toLocaleString()}
        </span>
      </div>

      {open === 'sources' && searchStep && (
        <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
          <ResultStep step={searchStep} />
        </div>
      )}
      {open === 'analysis' && analysisSteps.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--color-border)] space-y-3">
          {analysisSteps.map((s, i) => (
            <ResultStep key={i} step={s} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Research() {
  const { tasks } = useStore();
  const researchTasks = tasks
    .filter((t) => t.agent === 'research' && t.status === 'done')
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="font-[var(--font-display)] text-xl font-semibold mb-1">Research</h1>
      <p className="text-sm text-[var(--color-text-muted)] mb-6">
        Findings, leads, and competitor research the Research Agent has produced.
      </p>

      {researchTasks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-12 flex flex-col items-center text-center gap-3">
          <div className="w-11 h-11 rounded-md bg-[var(--color-accent-dim)] flex items-center justify-center">
            <Search size={20} className="text-[var(--color-accent)]" />
          </div>
          <div className="font-[var(--font-display)] font-semibold text-sm">No research yet</div>
          <p className="text-xs text-[var(--color-text-muted)] max-w-sm">
            Submit a goal like "research our top competitors" or "research our top leads" from Chat or the command palette.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {researchTasks.map((task) => (
            <ResearchCard key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}
