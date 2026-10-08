import { useState } from 'react';
import { ExternalLink, Copy, Check, Globe, Mail, Phone, MessageCircle } from 'lucide-react';

const PLATFORM_LABELS = {
  google_maps: 'Google Maps',
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  x: 'X',
  linkedin: 'LinkedIn',
  web: 'Web',
};

const CONFIDENCE_STYLES = {
  high: 'text-[var(--color-success)]',
  medium: 'text-[var(--color-warning)]',
  low: 'text-[var(--color-danger)]',
};

export default function LeadCard({ lead }) {
  const [copied, setCopied] = useState(false);

  async function copyDraft() {
    await navigator.clipboard.writeText(lead.socialDraft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--color-text)]">{lead.name}</div>
          <div className="text-[11px] text-[var(--color-text-muted)]">
            {[lead.type, lead.location].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {lead.needsWebsite && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-accent)]/10 text-[var(--color-accent)] font-medium">
              Needs website
            </span>
          )}
          <span className={`text-[10px] font-medium ${CONFIDENCE_STYLES[lead.confidence] || CONFIDENCE_STYLES.medium}`}>
            {lead.confidence}
          </span>
        </div>
      </div>

      {lead.platforms?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {lead.platforms.map((p, i) => (
            <a
              key={i}
              href={p.profileUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/40 transition-colors"
            >
              {PLATFORM_LABELS[p.platform] || p.platform}
              <ExternalLink size={8} />
              {p.followers && <span>({p.followers})</span>}
            </a>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-3 text-xs">
        {lead.email && (
          <span className="flex items-center gap-1">
            <Mail size={11} className="text-[var(--color-text-muted)]" />
            <a href={`mailto:${lead.email}`} className="text-[var(--color-accent)] hover:underline">{lead.email}</a>
            {lead.emailSource && (
              <a href={lead.emailSource} target="_blank" rel="noreferrer" className="text-[var(--color-text-muted)] hover:text-[var(--color-accent)]" title="Source">
                <ExternalLink size={9} />
              </a>
            )}
          </span>
        )}
        {lead.phone && (
          <span className="flex items-center gap-1">
            <Phone size={11} className="text-[var(--color-text-muted)]" />
            <span className="text-[var(--color-text)]">{lead.phone}</span>
            {lead.phoneSource && (
              <a href={lead.phoneSource} target="_blank" rel="noreferrer" className="text-[var(--color-text-muted)] hover:text-[var(--color-accent)]" title="Source">
                <ExternalLink size={9} />
              </a>
            )}
          </span>
        )}
        {lead.website && (
          <a href={lead.website} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[var(--color-accent)] hover:underline">
            <Globe size={11} /> Website
          </a>
        )}
      </div>

      {lead.activityLevel && (
        <div className="text-[11px] text-[var(--color-text-muted)]">{lead.activityLevel}</div>
      )}

      {lead.needsWebsiteReason && (
        <div className="text-[11px] text-[var(--color-text-muted)] italic">{lead.needsWebsiteReason}</div>
      )}

      {lead.socialDraft && (
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 space-y-1.5">
          <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)] font-[var(--font-mono)]">Draft DM</div>
          <div className="text-xs text-[var(--color-text)]">{lead.socialDraft}</div>
          <div className="flex items-center gap-2">
            <button
              onClick={copyDraft}
              className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/40 transition-colors"
            >
              {copied ? <Check size={10} /> : <Copy size={10} />}
              {copied ? 'Copied!' : 'Copy message'}
            </button>
            {lead.platforms?.[0]?.profileUrl && (
              <a
                href={lead.platforms[0].profileUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)]/40 transition-colors"
              >
                <MessageCircle size={10} />
                Open profile
              </a>
            )}
          </div>
        </div>
      )}

      <div className="text-[10px] text-[var(--color-text-muted)]">
        {lead.outreachChannel === 'email' && 'Email outreach drafted — check Approvals'}
        {lead.outreachChannel === 'whatsapp' && 'WhatsApp message drafted — check Approvals'}
        {lead.outreachChannel === 'social' && !lead.socialDraft && 'Social only — draft DM above or reach out manually'}
        {lead.outreachChannel === 'manual' && 'No contact info found — search for this business manually'}
      </div>
    </div>
  );
}
