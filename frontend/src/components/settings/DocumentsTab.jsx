import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, FileText, Trash2, RefreshCw, Eye, X, AlertCircle, CheckCircle2, Loader2, Replace } from 'lucide-react';
import { api } from '../../services/api';
import LoadingScreen from '../LoadingScreen';

// Settings -> General -> Documents.
// Menus, price lists, policies... The text is pulled out automatically and the
// WhatsApp agent searches it for every customer message.

const cardCls = 'bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-5';
const btnCls =
  'px-2.5 py-1.5 text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md hover:bg-[var(--color-surface-3)] flex items-center gap-1.5 disabled:opacity-50';

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error(`Couldn't read ${file.name} from your computer.`));
    reader.readAsDataURL(file);
  });
}

function size(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function when(iso) {
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; }
}

function errorText(err) {
  return err.details?.length && err.details[0] !== err.message ? `${err.message} ${err.details.join(' ')}` : err.message;
}

function Status({ doc }) {
  if (doc.status === 'processing') {
    return <span className="text-xs text-sky-500 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Processing…</span>;
  }
  if (doc.status === 'ready') {
    return (
      <span className="text-xs text-emerald-500 flex items-center gap-1">
        <CheckCircle2 size={12} /> Ready · {doc.chunk_count} {doc.chunk_count === 1 ? 'section' : 'sections'}
      </span>
    );
  }
  return <span className="text-xs text-[var(--color-danger)] flex items-center gap-1"><AlertCircle size={12} /> Failed</span>;
}

export default function DocumentsTab() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [docs, setDocs] = useState([]);
  const [accept, setAccept] = useState('.pdf,.docx,.txt,.md,.csv,.xlsx');
  const [maxBytes, setMaxBytes] = useState(10 * 1024 * 1024);
  const [busy, setBusy] = useState(null); // doc id or 'upload'
  const [error, setError] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const uploadInput = useRef(null);
  const replaceInput = useRef(null);
  const replaceTarget = useRef(null);

  const refresh = useCallback(async () => {
    const res = await api.listDocuments();
    setDocs(res.documents || []);
    if (res.accept) setAccept(res.accept.join(','));
    if (res.maxBytes) setMaxBytes(res.maxBytes);
    return res.documents || [];
  }, []);

  useEffect(() => {
    refresh().catch((err) => setLoadError(err.message)).finally(() => setLoading(false));
  }, [refresh]);

  // While anything is processing, check again every 2 seconds.
  const processing = docs.some((d) => d.status === 'processing');
  useEffect(() => {
    if (!processing) return undefined;
    const t = setInterval(() => { refresh().catch(() => {}); }, 2000);
    return () => clearInterval(t);
  }, [processing, refresh]);

  async function toPayload(file) {
    if (file.size > maxBytes) throw new Error(`${file.name} is too big (max ${size(maxBytes)}).`);
    return { filename: file.name, mime_type: file.type || null, data: await readAsBase64(file) };
  }

  async function uploadFiles(files) {
    setError(null);
    setBusy('upload');
    const problems = [];
    for (const file of files) {
      try {
        await api.uploadDocument(await toPayload(file));
      } catch (err) {
        problems.push(`${file.name}: ${errorText(err)}`);
      }
    }
    await refresh().catch(() => {});
    if (problems.length) setError(problems.join('\n'));
    setBusy(null);
  }

  async function replaceWith(file) {
    const doc = replaceTarget.current;
    if (!doc || !file) return;
    if (!window.confirm(`Replace "${doc.filename}" with "${file.name}"?\n\nThe new file is read straight away and the agent switches to it as soon as it's ready.`)) return;
    setError(null);
    setBusy(doc.id);
    try {
      await api.replaceDocument(doc.id, await toPayload(file));
      await refresh();
    } catch (err) {
      setError(`${file.name}: ${errorText(err)}`);
    }
    setBusy(null);
  }

  async function reprocess(doc) {
    setError(null);
    setBusy(doc.id);
    try { await api.reprocessDocument(doc.id); await refresh(); } catch (err) { setError(errorText(err)); }
    setBusy(null);
  }

  async function remove(doc) {
    if (!window.confirm(`Delete "${doc.filename}"?\n\nThe agent stops using it straight away. This can't be undone.`)) return;
    setError(null);
    setBusy(doc.id);
    try { await api.deleteDocument(doc.id); await refresh(); } catch (err) { setError(errorText(err)); }
    setBusy(null);
  }

  async function view(doc) {
    setError(null);
    setBusy(doc.id);
    try { setViewing(await api.getDocumentText(doc.id)); } catch (err) { setError(errorText(err)); }
    setBusy(null);
  }

  if (loading) return <LoadingScreen compact label="Loading documents…" />;
  if (loadError) {
    return (
      <div className={`${cardCls} text-sm flex items-start gap-2 text-[var(--color-danger)]`}>
        <AlertCircle size={16} className="mt-0.5 shrink-0" />
        <div><div className="font-medium mb-1">Couldn't load your documents</div><div className="text-[var(--color-text-muted)]">{loadError}</div></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section
        className={`${cardCls} border-dashed ${dragOver ? 'border-[var(--color-accent)]' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) uploadFiles([...e.dataTransfer.files]); }}
      >
        <h2 className="text-sm font-semibold mb-1 flex items-center gap-2"><Upload size={14} /> Upload documents</h2>
        <p className="text-xs text-[var(--color-text-muted)] mb-4">
          Menus, price lists, policies, brochures. PDF, Word (.docx), text, CSV or Excel, up to {size(maxBytes)} each.
          The text is read automatically and the WhatsApp agent uses it as soon as it shows <span className="text-emerald-500">Ready</span>.
          Drag files here or:
        </p>
        <input ref={uploadInput} type="file" multiple accept={accept} className="hidden"
          onChange={(e) => { const files = [...(e.target.files || [])]; e.target.value = ''; if (files.length) uploadFiles(files); }} />
        <button type="button" disabled={busy === 'upload'} onClick={() => uploadInput.current?.click()}
          className="px-4 py-2 text-sm bg-[var(--color-accent)] text-black rounded-md hover:opacity-90 disabled:opacity-50 flex items-center gap-2 font-medium">
          {busy === 'upload' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {busy === 'upload' ? 'Uploading…' : 'Choose files'}
        </button>
        <p className="text-[11px] text-[var(--color-text-muted)] mt-3">
          Scanned PDFs (photos of paper) have no readable text - use a Word or text version, or add the facts as Q&A entries.
        </p>
      </section>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 rounded-md text-sm text-[var(--color-danger)] whitespace-pre-wrap">
          <AlertCircle size={14} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      <section className={cardCls}>
        <h2 className="text-sm font-semibold mb-4">Your documents <span className="font-normal text-[var(--color-text-muted)]">· {docs.length}</span></h2>
        <input ref={replaceInput} type="file" accept={accept} className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; replaceWith(f); }} />
        {docs.length === 0 ? (
          <div className="text-xs italic text-[var(--color-text-muted)]">No documents yet.</div>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {docs.map((doc) => (
              <li key={doc.id} className="py-3">
                <div className="flex items-start gap-3 flex-wrap">
                  <FileText size={18} className="mt-0.5 text-[var(--color-text-muted)] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate" title={doc.filename}>{doc.filename}</div>
                    <div className="flex items-center gap-3 flex-wrap mt-0.5">
                      <Status doc={doc} />
                      <span className="text-xs text-[var(--color-text-muted)]">{size(doc.size_bytes)} · updated {when(doc.updated_at)}</span>
                    </div>
                    {doc.error && (
                      <div className={`text-xs mt-1 ${doc.status === 'failed' ? 'text-[var(--color-danger)]' : 'text-amber-500'}`}>{doc.error}</div>
                    )}
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    {doc.status === 'ready' && (
                      <button type="button" className={btnCls} disabled={busy === doc.id} onClick={() => view(doc)} title="See the text the agent reads"><Eye size={12} /> View text</button>
                    )}
                    {doc.status === 'failed' && (
                      <button type="button" className={btnCls} disabled={busy === doc.id} onClick={() => reprocess(doc)}><RefreshCw size={12} /> Process again</button>
                    )}
                    <button type="button" className={btnCls} disabled={busy === doc.id || doc.status === 'processing'}
                      onClick={() => { replaceTarget.current = doc; replaceInput.current?.click(); }}>
                      <Replace size={12} /> Replace
                    </button>
                    <button type="button" className={`${btnCls} hover:text-[var(--color-danger)]`} disabled={busy === doc.id} onClick={() => remove(doc)} aria-label={`Delete ${doc.filename}`}>
                      <Trash2 size={12} /> Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {viewing && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" onClick={() => setViewing(null)}>
          <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg max-w-3xl w-full max-h-[85vh] overflow-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold truncate">{viewing.document.filename}</h3>
              <button type="button" onClick={() => setViewing(null)} className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" aria-label="Close"><X size={16} /></button>
            </div>
            <p className="text-xs text-[var(--color-text-muted)] mb-3">
              This is the text the agent reads{viewing.total > viewing.shown ? ` (first ${viewing.shown} of ${viewing.total} sections)` : ''}. If something's missing or garbled here, the agent can't see it either.
            </p>
            <div className="space-y-2">
              {viewing.sections.map((s, i) => (
                <pre key={i} className="text-xs whitespace-pre-wrap bg-[var(--color-surface-2)] p-3 rounded-md font-[var(--font-mono)]">{s}</pre>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
