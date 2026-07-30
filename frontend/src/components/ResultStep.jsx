import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink } from 'lucide-react';

function SearchResults({ step }) {
  return (
    <div className="space-y-3">
      {step.answer && (
        <p className="text-sm text-[var(--color-text)] leading-relaxed">{step.answer}</p>
      )}
      <div className="space-y-2">
        {(step.results || []).map((r, i) => (
          <a
            key={i}
            href={r.url}
            target="_blank"
            rel="noreferrer"
            className="block rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 hover:border-[var(--color-accent)]/40 transition-colors"
          >
            <div className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-text)]">
              {r.title}
              <ExternalLink size={12} className="text-[var(--color-text-muted)] shrink-0" />
            </div>
            <div className="text-[11px] text-[var(--color-accent)] font-[var(--font-mono)] truncate mt-0.5">{r.url}</div>
            {r.content && (
              <p className="text-xs text-[var(--color-text-muted)] mt-1.5 line-clamp-2">{r.content}</p>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}

export default function ResultStep({ step, index }) {
  if (!step) return null;

  // Search tool result (Tavily-shaped: { answer, results: [...] })
  if (step.results && Array.isArray(step.results)) {
    return <SearchResults step={step} />;
  }

  // LLM text output - render as markdown
  if (step.text) {
    return (
      <div className="prose-codecraft prose prose-sm max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{step.text}</ReactMarkdown>
      </div>
    );
  }

  // Generic tool output (e.g. gmail send confirmation) - key/value fallback
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 space-y-1">
      {Object.entries(step).map(([k, v]) => (
        <div key={k} className="text-xs flex gap-2">
          <span className="text-[var(--color-text-muted)] font-[var(--font-mono)] shrink-0">{k}:</span>
          <span className="text-[var(--color-text)] break-all">{typeof v === 'string' ? v : JSON.stringify(v)}</span>
        </div>
      ))}
    </div>
  );
}
