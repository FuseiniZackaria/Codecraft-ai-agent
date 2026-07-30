import { Mail, MessageCircle, MessageSquare, GitBranch, Calendar, Hash, CheckCircle2, ExternalLink } from 'lucide-react';
import { useStore } from '../store/useStore';

const CATALOG = [
  { name: 'Telegram', icon: MessageCircle, desc: 'Message contacts and channels.' },
  { name: 'Google Calendar', icon: Calendar, desc: 'Create and manage events.' },
  { name: 'Slack', icon: Hash, desc: 'Post and read messages in channels.' },
];

function ComposioCard({ icon: Icon, name, desc, toolPrefix, connectedKey, viaLabel = 'via Composio', manageUrl = 'https://app.composio.dev', manageLabel = 'Manage in Composio' }) {
  const store = useStore();
  const loaded = store.summary.installedTools.some((t) => t.startsWith(`${toolPrefix}.`));
  const isConnected = store[connectedKey];

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-md bg-[var(--color-surface-2)] flex items-center justify-center">
          <Icon size={16} className="text-[var(--color-text-muted)]" />
        </div>
        <div className="font-[var(--font-display)] font-semibold text-sm">{name}</div>
        <span className="ml-auto text-[9px] uppercase tracking-wide text-[var(--color-text-muted)] font-[var(--font-mono)] border border-[var(--color-border)] rounded px-1.5 py-0.5">
          {viaLabel}
        </span>
      </div>
      <p className="text-xs text-[var(--color-text-muted)] flex-1">{desc}</p>

      {!store.connected || !loaded ? (
        <span className="text-xs text-[var(--color-text-muted)]">Backend not reachable</span>
      ) : isConnected ? (
        <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-success)]">
          <CheckCircle2 size={14} /> Connected
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-[var(--color-warning)]">Not connected</div>
          <a
            href={manageUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline w-fit"
          >
            {manageLabel} <ExternalLink size={11} />
          </a>
        </div>
      )}
    </div>
  );
}

export default function Plugins() {
  const { summary } = useStore();
  const installed = new Set(summary.installedTools.map((t) => t.split('.')[0]));

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="font-[var(--font-display)] text-xl font-semibold mb-1">Plugins</h1>
      <p className="text-sm text-[var(--color-text-muted)] mb-6">
        Install integrations to give agents new tools — no core changes required. Connections for
        Composio-backed tools (like Gmail) are managed in your Composio dashboard, not here.
      </p>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        <ComposioCard icon={Mail} name="Gmail" desc="Read and send email on your behalf." toolPrefix="gmail" connectedKey="gmailConnected" />
        <ComposioCard icon={MessageSquare} name="Reddit" desc="Post replies to threads the Sales Agent finds." toolPrefix="reddit" connectedKey="redditConnected" />
        <ComposioCard
          icon={MessageCircle}
          name="WhatsApp"
          desc="Send messages (within 24h of them texting first)."
          toolPrefix="whatsapp"
          connectedKey="whatsappConnected"
          viaLabel="via Meta direct"
          manageUrl="https://developers.facebook.com"
          manageLabel="Set up on Meta"
        />
        <ComposioCard icon={GitBranch} name="GitHub" desc="Create repos, commit files, and open pull requests." toolPrefix="github" connectedKey="githubConnected" />
        {CATALOG.map(({ name, icon: Icon, desc }) => {
          const isInstalled = installed.has(name.toLowerCase());
          return (
            <div key={name} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-md bg-[var(--color-surface-2)] flex items-center justify-center">
                  <Icon size={16} className="text-[var(--color-text-muted)]" />
                </div>
                <div className="font-[var(--font-display)] font-semibold text-sm">{name}</div>
              </div>
              <p className="text-xs text-[var(--color-text-muted)] flex-1">{desc}</p>
              <button
                disabled={isInstalled}
                className={`text-xs font-medium px-3 py-1.5 rounded-md border transition-colors ${
                  isInstalled
                    ? 'border-[var(--color-success)]/30 text-[var(--color-success)] cursor-default'
                    : 'border-[var(--color-accent)]/40 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10'
                }`}
              >
                {isInstalled ? 'Installed' : 'Install'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
