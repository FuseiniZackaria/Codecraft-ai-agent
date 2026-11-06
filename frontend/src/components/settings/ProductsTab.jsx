import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Package, Globe, Upload, Plus, Pencil, Trash2, RefreshCw, Search, X, Save, AlertCircle, CheckCircle2, Loader2, Languages, ExternalLink, ImageOff,
} from 'lucide-react';
import { api } from '../../services/api';
import LoadingScreen from '../LoadingScreen';

// Settings -> General -> Products.
// The catalogue the WhatsApp agent uses: answering "do you have...?", matching
// customer photos, checking stock and sending product photos.

const inputCls = 'w-full px-3 py-2 text-sm bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md focus:outline-none focus:border-[var(--color-accent)]';
const cardCls = 'bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg p-5';
const btnCls = 'px-2.5 py-1.5 text-xs bg-[var(--color-surface-2)] border border-[var(--color-border)] rounded-md hover:bg-[var(--color-surface-3)] flex items-center gap-1.5 disabled:opacity-50';
const primaryCls = 'px-4 py-2 text-sm bg-[var(--color-accent)] text-black rounded-md hover:opacity-90 disabled:opacity-50 flex items-center gap-2 font-medium';

const STOCK_LABEL = { in_stock: 'In stock', out_of_stock: 'Out of stock', unknown: 'Stock unknown', always_available: 'Always available' };
const STOCK_STYLE = {
  in_stock: 'bg-emerald-500/15 text-emerald-600',
  out_of_stock: 'bg-red-500/15 text-red-600',
  unknown: 'bg-amber-500/15 text-amber-600',
  always_available: 'bg-sky-500/15 text-sky-600',
};
const SOURCE_LABEL = { manual: 'Added by hand', csv: 'From a file', website: 'From your website' };
const METHOD_LABEL = { shopify: 'Shopify store', woocommerce: 'WooCommerce store', 'structured-data': 'product data on the page', 'page-text': 'page text (read by AI)' };

function errorText(err) {
  return err.details?.length && err.details[0] !== err.message ? `${err.message} ${err.details.join(' ')}` : err.message;
}
function when(iso) {
  if (!iso) return 'never';
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; }
}
function money(p) {
  if (p.price === null || p.price === undefined || p.price === '') return '-';
  return `${p.currency || 'GHS'} ${Number(p.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error(`Couldn't read ${file.name}.`));
    r.readAsDataURL(file);
  });
}

const EMPTY = { name: '', aliases: '', category: '', price: '', currency: 'GHS', stock_status: 'unknown', stock_qty: '', description: '', image_url: '', product_url: '', active: true };

function ProductForm({ initial, onCancel, onSaved }) {
  const [f, setF] = useState(() => ({ ...EMPTY, ...Object.fromEntries(Object.entries(initial || {}).map(([k, v]) => [k, v ?? ''])) }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { ...f, stock_qty: f.stock_qty === '' ? null : f.stock_qty, price: f.price === '' ? null : f.price };
    for (const k of ['id', 'workspace_id', 'created_at', 'updated_at', 'source', 'source_id', 'external_id', 'stock_checked_at', 'search', 'score', 'label']) delete body[k];
    try {
      const res = initial?.id ? await api.updateProduct(initial.id, body) : await api.createProduct(body);
      onSaved(res.product);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" onClick={onCancel}>
      <form onSubmit={save} className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg max-w-2xl w-full max-h-[90vh] overflow-auto p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2"><Package size={16} /> {initial?.id ? 'Edit product' : 'Add a product or service'}</h3>
          <button type="button" onClick={onCancel} className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" aria-label="Close"><X size={16} /></button>
        </div>
        {initial?.source === 'website' && (
          <p className="text-xs text-amber-600">This came from your website: the next sync updates its name, price, stock and photo again. Other names you add here are kept.</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="sm:col-span-2 text-xs font-medium text-[var(--color-text-muted)]">Name
            <input className={`${inputCls} mt-1`} value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Slim Black Trouser" required />
          </label>
          <label className="sm:col-span-2 text-xs font-medium text-[var(--color-text-muted)]">Other names customers use (comma-separated)
            <input className={`${inputCls} mt-1`} value={f.aliases} onChange={(e) => set('aliases', e.target.value)} placeholder="e.g. trouser, pants, slacks" />
          </label>
          <label className="text-xs font-medium text-[var(--color-text-muted)]">Category
            <input className={`${inputCls} mt-1`} value={f.category} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Trousers" />
          </label>
          <div className="grid grid-cols-[1fr_5rem] gap-2">
            <label className="text-xs font-medium text-[var(--color-text-muted)]">Price
              <input className={`${inputCls} mt-1`} type="number" min="0" step="0.01" value={f.price} onChange={(e) => set('price', e.target.value)} placeholder="optional" />
            </label>
            <label className="text-xs font-medium text-[var(--color-text-muted)]">Currency
              <input className={`${inputCls} mt-1`} value={f.currency} maxLength={5} onChange={(e) => set('currency', e.target.value.toUpperCase())} />
            </label>
          </div>
          <label className="text-xs font-medium text-[var(--color-text-muted)]">Stock
            <select className={`${inputCls} mt-1`} value={f.stock_status} onChange={(e) => set('stock_status', e.target.value)}>
              {Object.entries(STOCK_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-[var(--color-text-muted)]">Quantity left (optional)
            <input className={`${inputCls} mt-1`} type="number" min="0" step="1" value={f.stock_qty} onChange={(e) => set('stock_qty', e.target.value)} placeholder="e.g. 12" />
          </label>
          <label className="sm:col-span-2 text-xs font-medium text-[var(--color-text-muted)]">Photo link (sent to customers who ask to see it)
            <input className={`${inputCls} mt-1`} value={f.image_url} onChange={(e) => set('image_url', e.target.value)} placeholder="https://..." />
          </label>
          <label className="sm:col-span-2 text-xs font-medium text-[var(--color-text-muted)]">Product page link
            <input className={`${inputCls} mt-1`} value={f.product_url} onChange={(e) => set('product_url', e.target.value)} placeholder="https://..." />
          </label>
          <label className="sm:col-span-2 text-xs font-medium text-[var(--color-text-muted)]">Description
            <textarea rows={3} className={`${inputCls} mt-1`} value={f.description} onChange={(e) => set('description', e.target.value)} />
          </label>
        </div>
        {error && <div className="text-xs text-[var(--color-danger)] whitespace-pre-wrap">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="px-3 py-2 text-sm border border-[var(--color-border)] rounded-md hover:bg-[var(--color-surface-2)]">Cancel</button>
          <button type="submit" disabled={busy || !f.name.trim()} className={primaryCls}><Save size={14} /> {busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}

export default function ProductsTab() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [products, setProducts] = useState([]);
  const [sources, setSources] = useState([]);
  const [words, setWords] = useState([]);
  const [builtIn, setBuiltIn] = useState(0);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState(null); // product, or {} for new
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null); // { ok, text }
  const [site, setSite] = useState('');
  const [daily, setDaily] = useState(true);
  const [term, setTerm] = useState('');
  const [means, setMeans] = useState('');
  const [tryQ, setTryQ] = useState('');
  const [tryResult, setTryResult] = useState(null);
  const fileInput = useRef(null);

  async function load() {
    try {
      const res = await api.getProducts();
      setProducts(res.products || []);
      setSources(res.sources || []);
      setWords(res.synonyms || []);
      setBuiltIn(res.builtInWords || 0);
      setLoadError(null);
    } catch (err) {
      setLoadError(err.message);
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => {
    const w = filter.toLowerCase().split(/\s+/).filter(Boolean);
    if (!w.length) return products;
    return products.filter((p) => w.every((x) => `${p.name} ${p.aliases} ${p.category || ''}`.toLowerCase().includes(x)));
  }, [products, filter]);

  async function run(key, fn, okText) {
    setBusy(key);
    setNotice(null);
    try {
      const res = await fn();
      const text = typeof okText === 'function' ? okText(res) : okText;
      if (res?.error) setNotice({ ok: false, text: res.error });
      else if (text) setNotice({ ok: true, text });
      await load();
    } catch (err) {
      setNotice({ ok: false, text: errorText(err) });
    }
    setBusy(null);
  }

  const counts = (r) => [r.added ? `${r.added} added` : null, r.updated ? `${r.updated} updated` : null, r.removed ? `${r.removed} no longer on the site (switched off)` : null].filter(Boolean).join(', ') || 'no changes';

  if (loading) return <LoadingScreen compact label="Loading products…" />;
  if (loadError) {
    return (
      <div className={`${cardCls} text-sm flex items-start gap-2 text-[var(--color-danger)]`}>
        <AlertCircle size={16} className="mt-0.5 shrink-0" />
        <div><div className="font-medium mb-1">Couldn't load your products</div><div className="text-[var(--color-text-muted)]">{loadError}</div></div>
      </div>
    );
  }

  const activeCount = products.filter((p) => p.active).length;

  return (
    <div className="space-y-6">
      {notice && (
        <div className={`flex items-start gap-2 p-3 rounded-md text-sm border ${notice.ok ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-[var(--color-danger)]/10 border-[var(--color-danger)]/30 text-[var(--color-danger)]'}`}>
          {notice.ok ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-500" /> : <AlertCircle size={14} className="mt-0.5 shrink-0" />}
          <span className="flex-1">{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss"><X size={14} /></button>
        </div>
      )}

      {/* Website import */}
      <section className={cardCls}>
        <h2 className="text-sm font-semibold mb-1 flex items-center gap-2"><Globe size={14} /> Import from your website</h2>
        <p className="text-xs text-[var(--color-text-muted)] mb-3">
          Works with Shopify and WooCommerce shops, pages with product data, and normal websites (the AI reads the page and lists what you offer).
          Use the page that lists your products or services.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); run('site', () => api.addProductWebsite(site, daily), (r) => `Imported from ${r.source?.url} (${METHOD_LABEL[r.method] || r.method}): ${counts(r)}.`).then(() => setSite('')); }} className="flex flex-col sm:flex-row gap-2">
          <input className={inputCls} value={site} onChange={(e) => setSite(e.target.value)} placeholder="e.g. codecraft-wheat.vercel.app" aria-label="Website address" />
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-muted)] shrink-0">
            <input type="checkbox" checked={daily} onChange={(e) => setDaily(e.target.checked)} /> Re-sync daily
          </label>
          <button type="submit" disabled={!site.trim() || busy === 'site'} className={`${primaryCls} shrink-0`}>
            {busy === 'site' ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />} {busy === 'site' ? 'Importing…' : 'Import'}
          </button>
        </form>
        {sources.length > 0 && (
          <ul className="mt-4 divide-y divide-[var(--color-border)]">
            {sources.map((s) => (
              <li key={s.id} className="py-2.5 flex items-center gap-3 flex-wrap text-sm">
                <a href={s.url} target="_blank" rel="noreferrer" className="font-medium truncate max-w-xs hover:underline flex items-center gap-1">{s.url.replace(/^https?:\/\//, '')} <ExternalLink size={11} /></a>
                <span className={`text-[11px] px-1.5 py-0.5 rounded ${s.last_status === 'ok' ? 'bg-emerald-500/15 text-emerald-600' : s.last_status === 'failed' ? 'bg-red-500/15 text-red-600' : 'bg-[var(--color-surface-2)] text-[var(--color-text-muted)]'}`}>
                  {s.last_status === 'ok' ? `${s.item_count} items` : s.last_status === 'failed' ? 'Failed' : s.last_status === 'running' ? 'Syncing…' : 'Not synced'}
                </span>
                <span className="text-xs text-[var(--color-text-muted)]">last sync {when(s.last_synced_at)}{s.last_method ? ` · ${METHOD_LABEL[s.last_method] || s.last_method}` : ''}</span>
                {s.last_status === 'failed' && s.last_error && <span className="basis-full text-xs text-[var(--color-danger)]">{s.last_error}</span>}
                <span className="ml-auto flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                    <input type="checkbox" checked={!!s.daily_sync} onChange={(e) => run(`daily-${s.id}`, () => api.setProductWebsiteDaily(s.id, e.target.checked))} /> daily
                  </label>
                  <button type="button" className={btnCls} disabled={busy === `sync-${s.id}`} onClick={() => run(`sync-${s.id}`, () => api.syncProductWebsite(s.id), (r) => `Synced: ${counts(r)}.`)}>
                    <RefreshCw size={12} className={busy === `sync-${s.id}` ? 'animate-spin' : ''} /> Sync now
                  </button>
                  <button type="button" className={`${btnCls} hover:text-[var(--color-danger)]`} onClick={() => {
                    if (window.confirm(`Stop importing from ${s.url}? Its products are switched off (not deleted).`)) run(`rm-${s.id}`, () => api.removeProductWebsite(s.id), 'Website removed.');
                  }} aria-label={`Remove ${s.url}`}><Trash2 size={12} /></button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* File upload + add by hand */}
      <section className={cardCls}>
        <h2 className="text-sm font-semibold mb-1 flex items-center gap-2"><Upload size={14} /> Upload a list, or add by hand</h2>
        <p className="text-xs text-[var(--color-text-muted)] mb-3">
          CSV or Excel with a <b>Name</b> column; optional Price, Stock/Qty, Category, Description, Image, Link, Other names. Uploading again updates the same products.
        </p>
        <input ref={fileInput} type="file" accept=".csv,.xlsx" className="hidden" onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          run('file', async () => api.importProductsFile({ filename: file.name, data: await readAsBase64(file) }),
            (r) => `${file.name}: ${counts(r)}${r.skipped ? `, ${r.skipped} rows skipped (empty name or repeated)` : ''}.`);
        }} />
        <div className="flex gap-2 flex-wrap">
          <button type="button" className={primaryCls} disabled={busy === 'file'} onClick={() => fileInput.current?.click()}>
            {busy === 'file' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {busy === 'file' ? 'Uploading…' : 'Upload CSV / Excel'}
          </button>
          <button type="button" className={`${btnCls} !text-sm !px-4`} onClick={() => setEditing({})}><Plus size={14} /> Add a product</button>
        </div>
      </section>

      {/* List */}
      <section className={cardCls}>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <h2 className="text-sm font-semibold">Your products <span className="font-normal text-[var(--color-text-muted)]">· {products.length} ({activeCount} on)</span></h2>
          <div className="relative w-full sm:w-64">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input className={`${inputCls} pl-8`} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" aria-label="Filter products" />
          </div>
        </div>
        {products.length === 0 ? (
          <div className="text-xs italic text-[var(--color-text-muted)]">No products yet - import your website, upload a list or add one by hand.</div>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {shown.map((p) => (
              <li key={p.id} className={`py-3 flex items-center gap-3 ${p.active ? '' : 'opacity-55'}`}>
                <div className="w-11 h-11 rounded-md bg-[var(--color-surface-2)] border border-[var(--color-border)] overflow-hidden shrink-0 flex items-center justify-center">
                  {p.image_url ? <img src={p.image_url} alt="" className="w-full h-full object-cover" loading="lazy" /> : <ImageOff size={14} className="text-[var(--color-text-muted)]" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{p.name}</div>
                  <div className="text-xs text-[var(--color-text-muted)] truncate">
                    {[p.category, SOURCE_LABEL[p.source], p.aliases ? `also: ${p.aliases}` : null].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="text-sm tabular-nums hidden sm:block w-24 text-right">{money(p)}</div>
                <span className={`text-[11px] px-1.5 py-0.5 rounded whitespace-nowrap ${STOCK_STYLE[p.stock_status] || ''}`}>
                  {STOCK_LABEL[p.stock_status] || p.stock_status}{p.stock_qty != null && p.stock_status === 'in_stock' ? ` (${p.stock_qty})` : ''}
                </span>
                <button type="button" role="switch" aria-checked={p.active} title={p.active ? 'On - the agent can offer it' : 'Off - hidden from the agent'}
                  onClick={() => run(`on-${p.id}`, () => api.updateProduct(p.id, { active: !p.active }))}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full ${p.active ? 'bg-emerald-500' : 'bg-[var(--color-surface-3)] border border-[var(--color-border)]'}`}>
                  <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${p.active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
                <button type="button" className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}><Pencil size={14} /></button>
                <button type="button" className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-danger)]" aria-label={`Delete ${p.name}`}
                  onClick={() => { if (window.confirm(`Delete "${p.name}"?`)) run(`del-${p.id}`, () => api.deleteProduct(p.id)); }}>
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Local words + try the search */}
      <section className={cardCls}>
        <h2 className="text-sm font-semibold mb-1 flex items-center gap-2"><Languages size={14} /> Local words</h2>
        <p className="text-xs text-[var(--color-text-muted)] mb-3">
          Words customers use for your products (Pidgin, Twi, slang). {builtIn} common Ghanaian ones are built in (e.g. chalewote → slippers). Misspellings are handled automatically.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); run('word', () => api.addProductWord(term, means), 'Word added.').then(() => { setTerm(''); setMeans(''); }); }} className="flex flex-col sm:flex-row gap-2 mb-3">
          <input className={inputCls} value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Customers say… e.g. ahwenepa" aria-label="Word customers use" />
          <input className={inputCls} value={means} onChange={(e) => setMeans(e.target.value)} placeholder="It means… e.g. kente cloth" aria-label="What it means" />
          <button type="submit" className={`${btnCls} shrink-0 !text-sm`} disabled={!term.trim() || !means.trim()}><Plus size={14} /> Add</button>
        </form>
        {words.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {words.map((w) => (
              <span key={w.id} className="text-xs px-2 py-1 rounded-full bg-[var(--color-surface-2)] border border-[var(--color-border)] flex items-center gap-1.5">
                <b>{w.term}</b> → {w.means}
                <button type="button" onClick={() => run(`w-${w.id}`, () => api.removeProductWord(w.id))} aria-label={`Remove ${w.term}`} className="hover:text-[var(--color-danger)]"><X size={11} /></button>
              </span>
            ))}
          </div>
        )}
        <div className="pt-3 border-t border-[var(--color-border)]">
          <div className="text-xs font-medium text-[var(--color-text-muted)] mb-2">Try it: type what a customer might write</div>
          <form onSubmit={async (e) => { e.preventDefault(); try { setTryResult(await api.searchProducts(tryQ)); } catch (err) { setTryResult({ error: err.message }); } }} className="flex gap-2">
            <input className={inputCls} value={tryQ} onChange={(e) => setTryQ(e.target.value)} placeholder="e.g. abeg you get black trowser?" aria-label="Try a customer message" />
            <button type="submit" className={`${btnCls} shrink-0 !text-sm`} disabled={!tryQ.trim()}><Search size={14} /> Find</button>
          </form>
          {tryResult && (
            <div className="mt-2 text-xs">
              {tryResult.error ? <span className="text-[var(--color-danger)]">{tryResult.error}</span> : (
                <>
                  <div className="text-[var(--color-text-muted)]">Searched for: {tryResult.terms.join(', ') || '(nothing to search for)'}</div>
                  {tryResult.results.length ? (
                    <ol className="list-decimal ml-5 mt-1">{tryResult.results.map((r) => <li key={r.id}>{r.name} <span className="text-[var(--color-text-muted)]">({STOCK_LABEL[r.stock_status]})</span></li>)}</ol>
                  ) : <div className="mt-1">No match.</div>}
                </>
              )}
            </div>
          )}
        </div>
      </section>

      {editing && (
        <ProductForm initial={editing.id ? editing : null} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}
