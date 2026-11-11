import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Upload, Loader2, CheckCircle2, AlertCircle, Download, Trash2, Film, Palette, Copy, WifiOff, Sparkles, Image as ImageIcon, X,
} from 'lucide-react';
import { api } from '../services/api';
import { FieldTag, FieldError } from '../components/ui/FormField';

/**
 * Content Studio -> Video editor. Upload a video, answer three questions,
 * and the video editor does the rest (cuts retakes and pauses, fixes light,
 * levels voices, branded captions, top-quality export) - then download it
 * with its post caption and hashtags. Files go straight to storage.
 */

const PLATFORMS = [
  { value: 'instagram', label: 'Instagram', hint: '9:16 Reels' },
  { value: 'tiktok', label: 'TikTok', hint: '9:16' },
  { value: 'youtube', label: 'YouTube', hint: '16:9' },
];
const ACTIVE = ['uploading', 'queued', 'processing'];
const box = 'rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4';
const input = 'w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-accent)]';
const mb = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1024 ** 2))} MB`);

/** PUT a file to a signed storage link, with progress. */
function putFile(url, file, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}). Check your connection and try again.`)));
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
    xhr.send(file);
  });
}

export default function VideoEditor() {
  const [status, setStatus] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState(null);
  const [kitOpen, setKitOpen] = useState(false);

  const loadStatus = useCallback(() => api.getVideoStatus().then(setStatus).catch((e) => setError(e.message)), []);
  const loadJobs = useCallback(() => api.getVideoJobs().then(setJobs).catch(() => {}), []);

  useEffect(() => { loadStatus(); loadJobs(); }, [loadStatus, loadJobs]);
  useEffect(() => { const t = setInterval(loadStatus, 15000); return () => clearInterval(t); }, [loadStatus]);
  const anyActive = jobs.some((j) => ACTIVE.includes(j.status) || (j.status === 'done' && j.kind !== 'test_clip' && !j.result?.post));
  useEffect(() => {
    if (!anyActive) return undefined;
    const t = setInterval(loadJobs, 4000);
    return () => clearInterval(t);
  }, [anyActive, loadJobs]);

  if (!status && !error) return <p className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]"><Loader2 size={14} className="animate-spin" /> Loading the video editor…</p>;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2"><Film size={18} /> Video editor</h2>
        <p className="text-sm text-[var(--color-text-muted)]">Upload a video and answer three questions. Retakes and long pauses are cut, light and voices are fixed, your brand's captions are added, and you download it ready to post, with its caption and hashtags.</p>
      </div>

      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
      {status && !status.storageConfigured && (
        <div className="rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3 text-sm">Video storage isn't set up yet, so videos can't be uploaded. (The app owner adds the R2 settings on the backend - see docs/video-editor.md.)</div>
      )}
      {status && status.storageConfigured && !status.worker.online && (
        <div className="flex items-start gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 text-sm">
          <WifiOff size={16} className="mt-0.5 shrink-0 text-[var(--color-text-muted)]" />
          <span><strong>Video editor is offline.</strong> You can still upload - your job will start when it's back.</span>
        </div>
      )}

      <BrandKit open={kitOpen} setOpen={setKitOpen} status={status} onSaved={() => { loadStatus(); loadJobs(); }} />
      {status?.storageConfigured && <NewVideo status={status} onStarted={() => { loadJobs(); loadStatus(); }} needBrand={() => setKitOpen(true)} />}

      <div className="space-y-3">
        {jobs.length > 0 && <h3 className="text-sm font-semibold">Your videos</h3>}
        {jobs.map((j) => <JobCard key={j.id} job={j} stages={status?.stages || {}} workerOnline={!!status?.worker?.online} keepDays={status?.keepDays} onChange={loadJobs} />)}
      </div>
    </div>
  );
}

function NewVideo({ status, onStarted, needBrand }) {
  const [file, setFile] = useState(null);
  const [platform, setPlatform] = useState('');
  const [both, setBoth] = useState(false);
  const [cta, setCta] = useState('');
  const [style, setStyle] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState(null);
  const [notice, setNotice] = useState(null);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef(null);

  function pick(f) {
    if (!f) return;
    setErrors((e) => ({ ...e, file: null }));
    if (!f.type.startsWith('video/')) return setErrors((e) => ({ ...e, file: "That doesn't look like a video file (MP4, MOV…)." }));
    if (f.size > status.maxUploadBytes) return setErrors((e) => ({ ...e, file: `Videos can be up to ${mb(status.maxUploadBytes)}.` }));
    setFile(f);
  }

  async function start(e) {
    e.preventDefault();
    setNotice(null);
    const problems = {
      file: file ? null : 'Choose a video to upload.',
      platform: platform ? null : 'Where is the video going?',
      cta: cta.trim() ? null : 'What should viewers do at the end?',
      style: style ? null : 'Captions and graphics, or a clean cut?',
    };
    setErrors(problems);
    if (Object.values(problems).some(Boolean)) return;
    if (style === 'captions' && !status.brandKitReady) {
      needBrand();
      setErrors({ brand: 'Choose two brand colours and a font first (above) - they are saved for every video.' });
      return;
    }
    setBusy(true);
    try {
      const contentType = file.type || 'video/mp4';
      const { job, uploadUrl } = await api.startVideoJob({ name: file.name, bytes: file.size, contentType, platform, cta: cta.trim(), style, both_formats: both });
      setUploadPct(0);
      await putFile(uploadUrl, file, contentType, setUploadPct);
      await api.videoUploaded(job.id);
      setNotice({ ok: true, text: status.worker.online ? 'Uploaded. The video editor is on it - progress shows below.' : "Uploaded. The video editor is offline right now; your job will start when it's back." });
      setFile(null);
      setCta('');
      onStarted();
    } catch (err) {
      setErrors(err.body?.fieldErrors || {});
      setNotice({ ok: false, text: err.message });
    } finally {
      setBusy(false);
      setUploadPct(null);
    }
  }

  const choice = (active) => `px-3 py-2 rounded-md border text-sm text-left ${active ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10' : 'border-[var(--color-border)] hover:border-[var(--color-accent)]'}`;
  return (
    <form onSubmit={start} noValidate className={`${box} space-y-4`}>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
        className={`rounded-md border-2 border-dashed p-5 text-center ${drag ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5' : 'border-[var(--color-border)]'}`}
      >
        <input ref={fileInput} type="file" accept="video/*" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
        {file ? (
          <p className="text-sm"><strong>{file.name}</strong> ({mb(file.size)}) <button type="button" onClick={() => setFile(null)} className="ml-2 text-[var(--color-text-muted)] hover:text-[var(--color-danger)]" aria-label="Remove"><X size={14} className="inline" /></button></p>
        ) : (
          <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex flex-col items-center gap-1 text-sm">
            <Upload size={20} className="text-[var(--color-text-muted)]" />
            <span><strong>Choose a video</strong> or drop it here <FieldTag required /></span>
            <span className="text-xs text-[var(--color-text-muted)]">MP4, MOV and more, up to {mb(status.maxUploadBytes)}. Your original is never changed.</span>
          </button>
        )}
        <FieldError>{errors.file}</FieldError>
      </div>

      <fieldset>
        <legend className="text-sm font-medium mb-1.5">1. Where is the video going? <FieldTag required /></legend>
        <div className="grid grid-cols-3 gap-2">
          {PLATFORMS.map((p) => (
            <button type="button" key={p.value} onClick={() => { setPlatform(p.value); setErrors((e) => ({ ...e, platform: null })); }} className={choice(platform === p.value)} aria-pressed={platform === p.value}>
              <span className="block font-medium">{p.label}</span><span className="text-xs text-[var(--color-text-muted)]">{p.hint}</span>
            </button>
          ))}
        </div>
        <label className="mt-2 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <input type="checkbox" checked={both} onChange={(e) => setBoth(e.target.checked)} /> Also make the other shape (9:16 and 16:9) <FieldTag />
        </label>
        <FieldError>{errors.platform}</FieldError>
      </fieldset>

      <div>
        <label htmlFor="video-cta" className="block text-sm font-medium mb-1.5">2. What should viewers do at the end? <FieldTag required /></label>
        <input id="video-cta" value={cta} maxLength={120} onChange={(e) => { setCta(e.target.value); setErrors((x) => ({ ...x, cta: null })); }} placeholder='e.g. "Order on WhatsApp: 024 123 4567"' className={input} />
        <FieldError>{errors.cta}</FieldError>
      </div>

      <fieldset>
        <legend className="text-sm font-medium mb-1.5">3. Captions and graphics, or a clean cut? <FieldTag required /></legend>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => { setStyle('captions'); setErrors((e) => ({ ...e, style: null })); }} className={choice(style === 'captions')} aria-pressed={style === 'captions'}>
            <span className="block font-medium">Captions and graphics</span><span className="text-xs text-[var(--color-text-muted)]">Word-by-word captions, intro and end card in your brand</span>
          </button>
          <button type="button" onClick={() => { setStyle('clean'); setErrors((e) => ({ ...e, style: null })); }} className={choice(style === 'clean')} aria-pressed={style === 'clean'}>
            <span className="block font-medium">Clean cut</span><span className="text-xs text-[var(--color-text-muted)]">Just the edit, no text on screen</span>
          </button>
        </div>
        <FieldError>{errors.style}</FieldError>
        <FieldError>{errors.brand}</FieldError>
      </fieldset>

      {uploadPct !== null && (
        <div>
          <div className="h-2 rounded bg-[var(--color-surface-2)] overflow-hidden"><div className="h-full bg-[var(--color-accent)]" style={{ width: `${Math.round(uploadPct * 100)}%` }} /></div>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">Uploading… {Math.round(uploadPct * 100)}% - keep this page open until it finishes.</p>
        </div>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-[var(--color-accent)] text-black disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Upload and edit
        </button>
        {notice && <span className={`text-sm ${notice.ok ? 'text-emerald-600' : 'text-[var(--color-danger)]'}`}>{notice.text}</span>}
      </div>
    </form>
  );
}

function BrandKit({ open, setOpen, status, onSaved }) {
  const [kit, setKit] = useState(null);
  const [form, setForm] = useState({ colors: ['#E4572E', '#1B1B1E'], font: 'Montserrat', voice: '' });
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const logoInput = useRef(null);
  const brollInput = useRef(null);

  const load = useCallback(() => api.getBrandKit().then((k) => {
    setKit(k);
    if (k.colors?.length >= 2) setForm({ colors: k.colors, font: k.font || 'Montserrat', voice: k.voice || '' });
  }).catch(() => {}), []);
  useEffect(() => { if (open && !kit) load(); }, [open, kit, load]);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      setKit(await api.saveBrandKit({ colors: form.colors, font: form.font, voice: form.voice }));
      setErrors({});
      setNotice({ ok: true, text: 'Saved. Every video uses these from now on.' });
      onSaved();
    } catch (err) {
      setErrors(err.body?.fieldErrors || {});
      setNotice({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function uploadAsset(kind, file) {
    if (!file) return;
    setNotice(null);
    try {
      const contentType = file.type || 'application/octet-stream';
      const { key, uploadUrl } = await api.brandAssetUpload({ kind, name: file.name, contentType, bytes: file.size });
      await putFile(uploadUrl, file, contentType);
      setKit(await api.brandAssetConfirm({ kind, key, name: file.name }));
    } catch (err) {
      setNotice({ ok: false, text: err.message });
    }
  }

  async function testClip() {
    setTestBusy(true);
    setNotice(null);
    try {
      await api.videoTestClip('tiktok');
      setNotice({ ok: true, text: status?.worker?.online ? 'Test clip started - it appears under "Your videos" in a minute or two.' : "Test clip queued - it starts when the video editor is back online." });
      onSaved();
    } catch (err) {
      setNotice({ ok: false, text: err.message });
    } finally {
      setTestBusy(false);
    }
  }

  const ready = status?.brandKitReady;
  return (
    <div className={box}>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left">
        <Palette size={16} />
        <span className="font-medium text-sm">Brand kit</span>
        <span className={`text-xs ${ready ? 'text-emerald-600' : 'text-[var(--color-warning)]'}`}>{ready ? 'saved' : 'needed for captions: two colours and a font'}</span>
        <span className="ml-auto text-xs text-[var(--color-text-muted)]">{open ? 'Close' : 'Open'}</span>
      </button>
      {open && (
        <form onSubmit={save} noValidate className="mt-4 space-y-4">
          <div>
            <span className="block text-sm font-medium mb-1.5">Brand colours <FieldTag required /></span>
            <div className="flex flex-wrap items-center gap-3">
              {form.colors.map((c, i) => (
                <label key={i} className="flex items-center gap-1.5 text-xs">
                  <input type="color" value={c} onChange={(e) => setForm((f) => ({ ...f, colors: f.colors.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)) }))} aria-label={`Brand colour ${i + 1}`} className="h-8 w-10 rounded border border-[var(--color-border)]" />
                  <span className="font-mono">{c}</span>
                  {i >= 2 && <button type="button" onClick={() => setForm((f) => ({ ...f, colors: f.colors.filter((_, j) => j !== i) }))} aria-label="Remove colour"><X size={12} /></button>}
                </label>
              ))}
              {form.colors.length < 5 && <button type="button" onClick={() => setForm((f) => ({ ...f, colors: [...f.colors, '#FFFFFF'] }))} className="text-xs text-[var(--color-accent)]">+ colour</button>}
            </div>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">The first colour highlights the word being spoken; the second is the end card.</p>
            <FieldError>{errors.colors}</FieldError>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="brand-font" className="block text-sm font-medium mb-1.5">Font <FieldTag required /></label>
              <select id="brand-font" value={form.font} onChange={(e) => setForm((f) => ({ ...f, font: e.target.value }))} className={input}>
                {(kit?.fonts || status?.fonts || []).map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
              </select>
              <FieldError>{errors.font}</FieldError>
            </div>
            <div>
              <label htmlFor="brand-voice" className="block text-sm font-medium mb-1.5">Brand voice <FieldTag /></label>
              <input id="brand-voice" value={form.voice} onChange={(e) => setForm((f) => ({ ...f, voice: e.target.value }))} placeholder="e.g. warm, proud of home-cooked Ghanaian food" className={input} />
              <FieldError>{errors.voice}</FieldError>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <div>
              <span className="block font-medium mb-1.5">Logo <FieldTag /></span>
              <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => { uploadAsset('logo', e.target.files?.[0]); e.target.value = ''; }} />
              <div className="flex items-center gap-2">
                {kit?.logo?.url && <img src={kit.logo.url} alt="Your logo" className="h-10 w-auto rounded border border-[var(--color-border)] bg-white" />}
                <button type="button" onClick={() => logoInput.current?.click()} className="px-3 py-1.5 rounded-md border border-[var(--color-border)] text-xs">{kit?.logo ? 'Replace logo' : 'Upload logo'}</button>
              </div>
            </div>
            <div>
              <span className="block font-medium mb-1.5">B-roll kit <FieldTag /></span>
              <input ref={brollInput} type="file" accept="image/*,video/*" multiple className="hidden" onChange={async (e) => { for (const f of [...(e.target.files || [])]) await uploadAsset('broll', f); e.target.value = ''; }} />
              <button type="button" onClick={() => brollInput.current?.click()} className="px-3 py-1.5 rounded-md border border-[var(--color-border)] text-xs flex items-center gap-1"><ImageIcon size={12} /> Add photos</button>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">Name photos after what's in them (e.g. jollof-rice.jpg): when that word is said, the photo pops up.</p>
              {kit?.broll?.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {kit.broll.map((b) => (
                    <li key={b.key} className="flex items-center gap-1 text-xs rounded border border-[var(--color-border)] px-2 py-1">
                      {b.name}
                      <button type="button" aria-label={`Remove ${b.name}`} onClick={async () => setKit(await api.deleteBrandAsset(b.key))}><X size={11} /></button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy} className="px-4 py-2 rounded-md text-sm font-medium bg-[var(--color-accent)] text-black disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin" /> : 'Save brand kit'}</button>
            <button type="button" disabled={!ready || testBusy || !status?.storageConfigured} onClick={testClip} className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm border border-[var(--color-border)] disabled:opacity-50" title={ready ? '' : 'Save the brand kit first'}>
              {testBusy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Make a 7-second test clip
            </button>
            {notice && <span className={`text-sm ${notice.ok ? 'text-emerald-600' : 'text-[var(--color-danger)]'}`}>{notice.text}</span>}
          </div>
        </form>
      )}
    </div>
  );
}

function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }} className="text-xs flex items-center gap-1 text-[var(--color-accent)]">
      <Copy size={12} /> {done ? 'Copied' : 'Copy'}
    </button>
  );
}

function JobCard({ job, stages, workerOnline, keepDays, onChange }) {
  const [busy, setBusy] = useState(false);
  const outputs = job.result?.outputs || [];
  const videos = outputs.filter((o) => o.role === 'video');
  const test = outputs.find((o) => o.role === 'test_clip');
  const preview = videos[0] || test;
  const title = job.kind === 'test_clip' ? '7-second test clip' : job.original_name;
  const label = stages[job.stage] || job.stage;

  async function remove() {
    if (!window.confirm(ACTIVE.includes(job.status) ? 'Stop editing this video and delete it?' : 'Delete this video and its edited versions? Download anything you want to keep first.')) return;
    setBusy(true);
    try { await api.deleteVideoJob(job.id); onChange(); } finally { setBusy(false); }
  }

  return (
    <div className={box}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm truncate">{title}</div>
          <div className="text-xs text-[var(--color-text-muted)]">
            {job.kind !== 'test_clip' && `${job.answers?.platform || ''} · ${job.answers?.style === 'captions' ? 'captions and graphics' : 'clean cut'} · `}
            {new Date(job.created_at).toLocaleString()}
          </div>
        </div>
        {job.status === 'done' && <span className="flex items-center gap-1 text-xs font-medium text-emerald-600"><CheckCircle2 size={13} /> Ready</span>}
        {job.status === 'failed' && <span className="flex items-center gap-1 text-xs font-medium text-[var(--color-danger)]"><AlertCircle size={13} /> Didn't finish</span>}
        {job.status === 'canceled' && <span className="text-xs text-[var(--color-text-muted)]">Canceled</span>}
        <button type="button" onClick={remove} disabled={busy} className="text-[var(--color-text-muted)] hover:text-[var(--color-danger)]" aria-label="Delete"><Trash2 size={15} /></button>
      </div>

      {ACTIVE.includes(job.status) && (
        <div className="mt-3">
          <div className="h-2 rounded bg-[var(--color-surface-2)] overflow-hidden"><div className="h-full bg-[var(--color-accent)] transition-all" style={{ width: `${Math.max(3, job.progress || 0)}%` }} /></div>
          <p className="mt-1 text-xs text-[var(--color-text-muted)] flex items-center gap-1.5">
            {job.status === 'processing' && <Loader2 size={12} className="animate-spin" />}
            {job.status === 'uploading' && 'Waiting for the upload to finish…'}
            {job.status === 'queued' && (workerOnline ? 'In the queue - starting soon.' : "Video editor is offline - your job will start when it's back.")}
            {job.status === 'processing' && `${label}… ${job.progress || 0}%`}
          </p>
          {job.status === 'processing' && job.stage_log?.length > 0 && (
            <ul className="mt-2 text-xs text-[var(--color-text-muted)] space-y-0.5">
              {job.stage_log.filter((s, i, a) => a.findIndex((x) => x.stage === s.stage) === i).map((s) => (
                <li key={s.stage} className="flex items-center gap-1.5">{s.stage === job.stage ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} className="text-emerald-600" />}{s.label}{s.message && s.stage === job.stage ? ` - ${s.message}` : ''}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {job.status === 'failed' && <p className="mt-2 text-sm text-[var(--color-danger)]">{job.error}</p>}

      {job.status === 'done' && (
        <div className="mt-3 space-y-3">
          {preview?.previewUrl && (
            <video src={preview.previewUrl} controls preload="metadata" className={`rounded-md bg-black ${preview.format === '9x16' ? 'max-h-[480px] mx-auto' : 'w-full'}`} />
          )}
          <div className="flex flex-wrap gap-2">
            {outputs.map((o) => (
              <a key={o.name} href={o.downloadUrl} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border border-[var(--color-border)] hover:border-[var(--color-accent)]">
                <Download size={12} /> {o.role === 'test_clip' ? '7-second test clip' : `${o.partTitle ? `${o.partTitle} · ` : ''}${o.format === '9x16' ? '9:16' : '16:9'} ${o.width}x${o.height}`}
              </a>
            ))}
          </div>
          {videos.length > 0 && (
            <p className="text-xs text-[var(--color-text-muted)]">
              Saved next to your original ({job.original_name}) as {videos.map((v) => v.name).join(', ')}. Kept for {keepDays || 14} days - download what you want to keep.
            </p>
          )}
          {job.result?.notes?.length > 0 && (
            <ul className="text-sm list-disc pl-5 space-y-0.5">{job.result.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          )}
          <p className="text-sm font-medium text-[var(--color-warning)]">Watch it all the way through before you post it.</p>

          {job.kind !== 'test_clip' && (
            job.result?.post ? (
              (job.result.post.parts || []).map((p, i) => (
                <div key={i} className="rounded-md bg-[var(--color-surface-2)] p-3 text-sm space-y-2">
                  <div className="flex items-center gap-2 font-medium">{p.platform} caption{p.title ? ` - ${p.title}` : ''} <span className="ml-auto"><CopyButton text={`${p.caption}\n\n${(p.hashtags || []).join(' ')}`} /></span></div>
                  <p className="whitespace-pre-wrap">{p.caption}</p>
                  {p.hashtags?.length > 0 && <p className="text-[var(--color-accent)]">{p.hashtags.join(' ')}</p>}
                </div>
              )).concat(job.result.post.note ? [<p key="n" className="text-xs text-[var(--color-text-muted)]">{job.result.post.note}</p>] : [])
            ) : (
              <p className="text-xs text-[var(--color-text-muted)] flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Writing the post caption and hashtags…</p>
            )
          )}
        </div>
      )}
    </div>
  );
}
