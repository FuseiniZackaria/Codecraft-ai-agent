import { useState, useEffect, useRef } from 'react';
import {
  Package, Search, Download, Power, PowerOff, Trash2, Wrench,
  Shield, CheckCircle2, XCircle, Loader2,
} from 'lucide-react';
import { api } from '../services/api';

function PermissionDialog({ manifest, onCancel, onApprove }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-1">
          <Shield size={16} className="text-[var(--color-accent)]" />
          <h3 className="font-[var(--font-display)] font-semibold">{manifest.name}</h3>
        </div>
        <p className="text-xs text-[var(--color-text-muted)] mb-4">
          v{manifest.version} by {manifest.author} — {manifest.description}
        </p>

        {manifest.permissions.length > 0 ? (
          <>
            <div className="text-xs text-[var(--color-text-muted)] mb-2">This skill requests access to:</div>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {manifest.permissions.map((p) => (
                <span key={p} className="text-[11px] px-2 py-1 rounded border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 text-[var(--color-warning)]">
                  {p}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="text-xs text-[var(--color-text-muted)] mb-4">This skill requests no special permissions.</div>
        )}

        {manifest.dependencies.length > 0 && (
          <div className="mb-4">
            <div className="text-xs text-[var(--color-text-muted)] mb-1">Dependencies:</div>
            <div className="text-xs font-[var(--font-mono)] text-[var(--color-text)]">{manifest.dependencies.join(', ')}</div>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => onApprove(manifest.permissions)}
            className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium px-3 py-2 rounded-md bg-[var(--color-accent)] text-black hover:brightness-110"
          >
            <CheckCircle2 size={14} /> Approve & Install
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-2 rounded-md border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function InstallConsole({ skillId, installPromise, onClose }) {
  const [lines, setLines] = useState([]);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const seenIds = useRef(new Set());

  function addLine(event) {
    if (seenIds.current.has(event.id)) return;
    seenIds.current.add(event.id);
    setLines((prev) => [...prev, event].sort((a, b) => new Date(a.at) - new Date(b.at)));
  }

  useEffect(() => {
    const es = new EventSource(api.eventsStreamUrl());
    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data);
        if (event.actor !== 'installer' || event.target !== skillId) return;
        addLine(event);
      } catch {
        // ignore comment/ping lines
      }
    };

    // The install itself is the real source of truth for done/failed - SSE
    // is best-effort display only. A fast local install can fully complete
    // before this EventSource finishes its handshake, so relying on SSE
    // alone would leave the console stuck spinning forever with nothing to
    // show. Once the promise settles, backfill from /events/recent so the
    // log is accurate even if the live stream missed early stages.
    let installFailed = false;
    installPromise
      .catch((e) => {
        installFailed = true;
        setErrorMsg(e.message);
      })
      .finally(async () => {
        try {
          const recent = await api.getRecentEvents(50);
          recent.filter((e) => e.actor === 'installer' && e.target === skillId).forEach(addLine);
        } catch {
          // best-effort backfill only
        }
        es.close();
        if (installFailed) setFailed(true);
        else setDone(true);
      });

    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillId]);

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-black/40 p-3 font-[var(--font-mono)] text-xs mt-3">
      {lines.length === 0 && !done && !failed && (
        <div className="flex items-center gap-2 py-0.5 text-[var(--color-text-muted)]">
          <Loader2 size={12} className="text-[var(--color-accent)] animate-spin" /> installing…
        </div>
      )}
      {lines.map((e) => (
        <div key={e.id} className="flex items-center gap-2 py-0.5">
          {e.action === 'install.completed' ? (
            <CheckCircle2 size={12} className="text-[var(--color-success)] shrink-0" />
          ) : e.action === 'install.failed' ? (
            <XCircle size={12} className="text-[var(--color-danger)] shrink-0" />
          ) : (
            <Loader2 size={12} className="text-[var(--color-accent)] shrink-0" />
          )}
          <span className="text-[var(--color-text-muted)]">{e.action}</span>
          {e.metadata?.error && <span className="text-[var(--color-danger)]">{e.metadata.error}</span>}
        </div>
      ))}
      {failed && errorMsg && !lines.some((l) => l.action === 'install.failed') && (
        <div className="flex items-center gap-2 py-0.5">
          <XCircle size={12} className="text-[var(--color-danger)] shrink-0" />
          <span className="text-[var(--color-danger)]">{errorMsg}</span>
        </div>
      )}
      {(done || failed) && (
        <button onClick={onClose} className="mt-2 text-[11px] text-[var(--color-accent)] hover:underline">
          Close
        </button>
      )}
    </div>
  );
}

function InstalledSkillRow({ skill, onChanged }) {
  const [busy, setBusy] = useState(false);

  async function run(action) {
    setBusy(true);
    try {
      if (action === 'enable') await api.enableSkill(skill.id);
      if (action === 'disable') await api.disableSkill(skill.id);
      if (action === 'repair') await api.repairSkill(skill.id);
      if (action === 'remove') {
        if (!window.confirm(`Remove ${skill.name}? This deletes its files.`)) return;
        await api.removeSkill(skill.id);
      }
      onChanged();
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--color-border)] last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{skill.name}</span>
          <span className="text-[10px] font-[var(--font-mono)] text-[var(--color-text-muted)]">v{skill.version}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${skill.status === 'enabled' ? 'text-[var(--color-success)] border-[var(--color-success)]/30 bg-[var(--color-success)]/10' : 'text-[var(--color-text-muted)] border-[var(--color-border)]'}`}>
            {skill.status}
          </span>
        </div>
        <div className="text-[11px] text-[var(--color-text-muted)] truncate">{skill.description}</div>
        {skill.permissions?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {skill.permissions.map((p) => (
              <span key={p} className="text-[10px] font-[var(--font-mono)] px-1.5 py-0.5 rounded bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">{p}</span>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {skill.status === 'enabled' ? (
          <button disabled={busy} onClick={() => run('disable')} title="Disable" className="p-1.5 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-warning)] disabled:opacity-40">
            <PowerOff size={14} />
          </button>
        ) : (
          <button disabled={busy} onClick={() => run('enable')} title="Enable" className="p-1.5 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-success)] disabled:opacity-40">
            <Power size={14} />
          </button>
        )}
        <button disabled={busy} onClick={() => run('repair')} title="Repair" className="p-1.5 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] disabled:opacity-40">
          <Wrench size={14} />
        </button>
        <button disabled={busy} onClick={() => run('remove')} title="Remove" className="p-1.5 rounded-md border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-danger)] disabled:opacity-40">
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

export default function Skills() {
  const [tab, setTab] = useState('installed');
  const [installed, setInstalled] = useState([]);
  const [marketplace, setMarketplace] = useState([]);
  const [query, setQuery] = useState('');
  const [customSource, setCustomSource] = useState('');
  const [pendingPreview, setPendingPreview] = useState(null);
  const [installingId, setInstallingId] = useState(null);
  const [installPromise, setInstallPromise] = useState(null);
  const [error, setError] = useState(null);

  async function refresh() {
    try {
      setInstalled(await api.listSkills());
      setMarketplace(await api.searchRegistry(query));
    } catch {
      // backend not reachable - leave lists empty, page still renders
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function startInstall(source) {
    setError(null);
    try {
      const { manifest } = await api.previewInstall(source);
      setPendingPreview({ source, manifest });
    } catch (err) {
      setError(err.message);
    }
  }

  function approveAndInstall(permissions) {
    const { source, manifest } = pendingPreview;
    setPendingPreview(null);
    setInstallingId(manifest.id);
    // Store the promise itself (don't await here) - InstallConsole owns
    // watching it settle, so the console can render immediately while the
    // install runs, rather than this function blocking until it's done.
    setInstallPromise(api.installSkill(source, permissions));
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center gap-2 mb-1">
        <Package size={20} className="text-[var(--color-accent)]" />
        <h1 className="font-[var(--font-display)] text-xl font-semibold">Skills</h1>
      </div>
      <p className="text-sm text-[var(--color-text-muted)] mb-4">
        Install, manage, and remove skills — new tools and agents, activated live with no restart.
      </p>

      <div className="flex gap-1 mb-4 border-b border-[var(--color-border)]">
        {['installed', 'marketplace'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm capitalize border-b-2 -mb-px ${
              tab === t ? 'border-[var(--color-accent)] text-[var(--color-text)]' : 'border-transparent text-[var(--color-text-muted)]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 p-3 text-xs text-[var(--color-danger)]">
          {error}
        </div>
      )}

      {tab === 'installed' && (
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
          {installed.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">
              No skills installed yet — check the Marketplace tab.
            </div>
          ) : (
            installed.map((s) => <InstalledSkillRow key={s.id} skill={s} onChanged={refresh} />)
          )}
        </div>
      )}

      {tab === 'marketplace' && (
        <div className="space-y-4">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-[var(--color-text-muted)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the registry…"
              className="w-full pl-8 pr-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-sm outline-none focus:border-[var(--color-accent)]/50"
            />
          </div>

          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] divide-y divide-[var(--color-border)]">
            {marketplace.length === 0 ? (
              <div className="p-6 text-center text-sm text-[var(--color-text-muted)]">No skills found.</div>
            ) : (
              marketplace.map((s) => (
                <div key={s.id} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{s.name} <span className="text-[10px] font-[var(--font-mono)] text-[var(--color-text-muted)]">v{s.version}</span></div>
                      <div className="text-xs text-[var(--color-text-muted)]">{s.description}</div>
                    </div>
                    <button
                      onClick={() => startInstall(`registry:${s.id}`)}
                      className="flex items-center gap-1.5 shrink-0 text-xs font-medium px-3 py-1.5 rounded-md border border-[var(--color-accent)]/40 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
                    >
                      <Download size={13} /> Install
                    </button>
                  </div>
                  {installingId === s.id && <InstallConsole skillId={s.id} installPromise={installPromise} onClose={() => { setInstallingId(null); setInstallPromise(null); refresh(); }} />}
                </div>
              ))
            )}
          </div>

          <div className="rounded-lg border border-dashed border-[var(--color-border)] p-4">
            <div className="text-xs text-[var(--color-text-muted)] mb-2">
              Install from GitHub, a .zip URL, or a local path — same formats as the CLI.
            </div>
            <div className="flex gap-2">
              <input
                value={customSource}
                onChange={(e) => setCustomSource(e.target.value)}
                placeholder="github:user/skill  ·  https://.../skill.zip  ·  ./local-skill"
                className="flex-1 px-3 py-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] text-sm font-[var(--font-mono)] outline-none focus:border-[var(--color-accent)]/50"
              />
              <button
                onClick={() => customSource.trim() && startInstall(customSource.trim())}
                className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-md bg-[var(--color-accent)] text-black hover:brightness-110"
              >
                <Download size={14} /> Install
              </button>
            </div>
          </div>

          {installingId && !marketplace.some((s) => s.id === installingId) && (
            <InstallConsole skillId={installingId} installPromise={installPromise} onClose={() => { setInstallingId(null); setInstallPromise(null); refresh(); }} />
          )}
        </div>
      )}

      {pendingPreview && (
        <PermissionDialog
          manifest={pendingPreview.manifest}
          onCancel={() => setPendingPreview(null)}
          onApprove={approveAndInstall}
        />
      )}
    </div>
  );
}
