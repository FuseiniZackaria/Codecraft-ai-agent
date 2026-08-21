import { useEffect, useState, useRef } from 'react';
import { Zap, X, ChevronDown, ChevronUp, Terminal, BookOpen } from 'lucide-react';
import { api } from '../services/api';

const POLL_INTERVAL_MS = 5000;

export default function ConnectorPrompt() {
  const [prompt, setPrompt] = useState(null);
  const [cliResult, setCliResult] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [connectState, setConnectState] = useState('idle'); // idle | connecting | connected | error
  const [connectedTools, setConnectedTools] = useState(null);
  const [connectError, setConnectError] = useState(null);
  const [importState, setImportState] = useState('idle'); // idle | importing | imported | error
  const [importedSkillId, setImportedSkillId] = useState(null);
  const [importError, setImportError] = useState(null);
  const dismissedOrigins = useRef(new Set());
  const cliDismissedOrigins = useRef(new Set());

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const result = await api.getBrowserPrompt();
      if (cancelled || !result) return;

      if (result.shouldPrompt && !dismissedOrigins.current.has(result.detection.origin)) {
        setPrompt(result);
      } else {
        setPrompt(null);
      }

      if (result.cliMentionFound && !cliDismissedOrigins.current.has(result.cliDetection.origin)) {
        setCliResult(result);
      } else {
        setCliResult(null);
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  function dismiss() {
    dismissedOrigins.current.add(detection.origin);
    setPrompt(null);
    setExpanded(false);
    setConnectState('idle');
    setConnectedTools(null);
    setConnectError(null);
  }

  function dismissCli() {
    if (cliResult?.cliDetection?.origin) cliDismissedOrigins.current.add(cliResult.cliDetection.origin);
    setCliResult(null);
    setImportState('idle');
    setImportedSkillId(null);
    setImportError(null);
  }

  async function handleImportCli() {
    setImportState('importing');
    setImportError(null);
    const pageUrl = cliResult?.site?.url;
    const command = cliResult?.cliDetection?.matches?.[0]?.command;
    const result = await api.importCLIAsSkill(pageUrl, command);
    if (result?.ok) {
      setImportedSkillId(result.skillId);
      setImportState('imported');
    } else {
      setImportError(result?.error || 'Import failed for an unknown reason.');
      setImportState('error');
    }
  }

  async function handleConnect() {
    setConnectState('connecting');
    setConnectError(null);
    const result = await api.connectMCP(site.url);
    if (result?.ok) {
      setConnectedTools(result.tools);
      setConnectState('connected');
    } else {
      setConnectError(result?.error || 'Connection failed for an unknown reason.');
      setConnectState('error');
    }
  }

  if (!prompt && !cliResult) return null;

  const { site, detection } = prompt || {};
  const manifestName = detection?.manifest?.name || 'an MCP server';

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-96 flex-col gap-2">
      {prompt && (
        <div className="rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-surface)] shadow-lg">
          <div className="flex items-start gap-3 p-4">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-dim)]">
              <Zap size={16} className="text-[var(--color-accent)]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--color-text)]">
                {site?.title || detection.origin} has {manifestName}
              </p>
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                Detected at <code className="font-[var(--font-mono)]">{detection.matchedPath}</code>
              </p>

              {connectState === 'idle' && (
                <button
                  onClick={handleConnect}
                  className="mt-2 rounded-md bg-[var(--color-accent)] px-3 py-1 text-xs font-medium text-white hover:opacity-90"
                >
                  Connect
                </button>
              )}
              {connectState === 'connecting' && (
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">Connecting...</p>
              )}
              {connectState === 'connected' && (
                <p className="mt-2 text-xs text-[var(--color-success)]">
                  Connected - found {connectedTools.length} tool{connectedTools.length === 1 ? '' : 's'}:{' '}
                  {connectedTools.map((t) => t.name).join(', ')}
                </p>
              )}
              {connectState === 'error' && (
                <p className="mt-2 text-xs text-[var(--color-warning)]">Couldn't connect: {connectError}</p>
              )}

              <button
                onClick={() => setExpanded((e) => !e)}
                className="mt-2 flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline"
              >
                {expanded ? 'Hide raw manifest' : 'View raw manifest'}
                {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
              {expanded && (
                <pre className="mt-2 max-h-40 overflow-auto rounded bg-[var(--color-surface-2)] p-2 text-[10px] text-[var(--color-text-muted)] font-[var(--font-mono)]">
                  {JSON.stringify(detection.manifest, null, 2)}
                </pre>
              )}
            </div>
            <button onClick={dismiss} className="shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" aria-label="Dismiss">
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {cliResult && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
          <div className="flex items-start gap-3 p-3">
            <Terminal size={14} className="mt-0.5 shrink-0 text-[var(--color-text-muted)]" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-[var(--color-text-muted)]">
                This page mentions a possible install command - not verified, just spotted in the page text:
              </p>
              <code className="mt-1 block truncate text-[10px] text-[var(--color-text)] font-[var(--font-mono)]">
                {cliResult.cliDetection.matches[0]?.command}
              </code>

              {importState === 'idle' && (
                <button
                  onClick={handleImportCli}
                  className="mt-2 flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-[11px] font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
                  title="Saves this page's own text as reference content for your agents - does not run the command or install anything on your machine"
                >
                  <BookOpen size={11} />
                  Import as skill
                </button>
              )}
              {importState === 'importing' && (
                <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">Reading the page and importing...</p>
              )}
              {importState === 'imported' && (
                <p className="mt-2 text-[11px] text-[var(--color-success)]">
                  Imported as <code className="font-[var(--font-mono)]">{importedSkillId}</code> - the page's text is now
                  reference guidance for your agents. The command itself was never run.
                </p>
              )}
              {importState === 'error' && (
                <p className="mt-2 text-[11px] text-[var(--color-warning)]">Couldn't import: {importError}</p>
              )}
              <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                This never runs the command or installs anything on your machine - it only saves the page's own text.
              </p>
            </div>
            <button onClick={dismissCli} className="shrink-0 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
