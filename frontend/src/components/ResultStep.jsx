import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink } from 'lucide-react';
import LeadCard from './LeadCard';

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

// A page the Browser agent read ({ url, title, text, contacts? }). The page
// text is the agent's raw input, not something to show - the next step
// summarises it. Show what was read and any contact details found instead.
function isPageRead(step) {
  return typeof step.url === 'string' && typeof step.text === 'string' && 'title' in step && !step.provider;
}

function PageReadStep({ step }) {
  const emails = step.contacts?.emails || [];
  const phones = step.contacts?.phones || [];
  const pages = step.contacts?.pagesChecked || [step.url];
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 space-y-1.5">
      <a
        href={step.url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-text)] hover:text-[var(--color-accent)]"
      >
        Read: {step.title || step.url}
        <ExternalLink size={12} className="text-[var(--color-text-muted)] shrink-0" />
      </a>
      <div className="text-[11px] text-[var(--color-text-muted)]">
        {pages.length === 1 ? '1 page checked' : `${pages.length} pages checked`}
      </div>
      {step.contacts && (
        <div className="text-xs text-[var(--color-text)]">
          {emails.length || phones.length
            ? [...emails, ...phones].join(' · ')
            : 'No email or phone number found'}
        </div>
      )}
    </div>
  );
}

// An outreach draft the Sales agent returned as JSON text: {"to","subject","body"}.
function parseEmailDraft(text) {
  if (typeof text !== 'string') return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const d = JSON.parse(match[0]);
    return d && typeof d.subject === 'string' && typeof d.body === 'string' ? d : null;
  } catch {
    return null;
  }
}

function EmailDraftStep({ draft }) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 space-y-2">
      <div className="text-xs space-y-0.5">
        <div><span className="text-[var(--color-text-muted)]">To: </span><span className="text-[var(--color-text)]">{draft.to || 'no email found'}</span></div>
        <div><span className="text-[var(--color-text-muted)]">Subject: </span><span className="font-medium text-[var(--color-text)]">{draft.subject}</span></div>
      </div>
      <div className="text-sm text-[var(--color-text)] leading-relaxed whitespace-pre-line border-t border-[var(--color-border)] pt-2">
        {draft.body}
      </div>
    </div>
  );
}

export default function ResultStep({ step, index }) {
  if (!step) return null;

  if (isPageRead(step)) {
    return <PageReadStep step={step} />;
  }

  const draft = step.provider ? parseEmailDraft(step.text) : null;
  if (draft) {
    return <EmailDraftStep draft={draft} />;
  }

  // Multi-platform lead cards
  if (step.type === 'lead_cards') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-[var(--color-text)] leading-relaxed">{step.summary}</p>
        {step.warnings?.length > 0 && (
          <div className="rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/5 p-2.5 space-y-1">
            {step.warnings.map((w, i) => (
              <p key={i} className="text-xs text-[var(--color-warning)]">{w}</p>
            ))}
          </div>
        )}
        {(step.leads || []).map((lead, i) => (
          <LeadCard key={i} lead={lead} />
        ))}
      </div>
    );
  }

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
