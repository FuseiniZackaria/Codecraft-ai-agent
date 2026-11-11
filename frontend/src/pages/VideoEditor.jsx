import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Upload, Loader2, CheckCircle2, AlertCircle, Download, Trash2, Film, Palette, Copy, WifiOff, Sparkles, Image as ImageIcon, X,
} from 'lucide-react';
import { api } from '../services/api';
import { useStore } from '../store/useStore';
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

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

/**
 * Lock website login details for the video worker: AES-256-GCM, with the key
 * wrapped by the worker's RSA public key. The server in between can't read
 * them; they are never stored. Returns the sealed box (no plain text).
 */
async function sealLogin(loginKey, username, password) {
  if (!loginKey?.publicKey || !window.crypto?.subtle) throw new Error('The video editor must be online to accept login details securely. Start it, then try again.');
  const pub = await crypto.subtle.importKey('spki', fromB64(loginKey.publicKey), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, new TextEncoder().encode(JSON.stringify({ username, password })));
  const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, await crypto.subtle.exportKey('raw', aes));
  return { keyId: loginKey.keyId, wrappedKey: b64(wrapped), iv: b64(iv), data: b64(data) };
}

const MODES = [
  { value: 'auto', label: 'Edit my video', hint: 'Automatic: retakes, pauses, light, voices, captions' },
  { value: 'custom', label: 'Edit my video my way', hint: 'Describe the edit; approve the plan first' },
  { value: 'website', label: 'Make a video of my website', hint: 'Paste a link; approve the script first' },
];

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
      <StorageCheck />

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
        {jobs.map((j) => <JobCard key={j.id} job={j} stages={status?.stages || {}} workerOnline={!!status?.worker?.online} loginKey={status?.worker?.loginKey} keepDays={status?.keepDays} onChange={loadJobs} />)}
      </div>
    </div>
  );
}

/** App owner only: test the R2 settings for real and say which one is wrong. */
function StorageCheck() {
  const isAppOwner = useStore((s) => !!s.user?.isAppOwner);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!isAppOwner) return null;
  async function run() {
    setBusy(true);
    setResult(null);
    try { setResult(await api.checkVideoStorage()); } catch (err) { setResult({ ok: false, problem: err.message }); } finally { setBusy(false); }
  }
  return (
    <div className="text-sm">
      <button type="button" onClick={run} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border border-[var(--color-border)] hover:border-[var(--color-accent)] disabled:opacity-50">
        {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Check storage (R2)
      </button>
      {result && (
        <div className={`mt-2 rounded-md border p-3 ${result.ok ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5'}`}>
          <p className={result.ok ? 'text-emerald-700' : 'text-[var(--color-danger)]'}>{result.ok ? result.message : result.problem}</p>
          {result.findings?.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-[var(--color-text-muted)]">{result.findings.map((f, i) => <li key={i}>{f}</li>)}</ul>}
          {!result.ok && <p className="mt-1 text-xs text-[var(--color-text-muted)]">Fix it on Render (backend → Environment), wait for the restart, then check again.</p>}
        </div>
      )}
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
  const [mode, setMode] = useState('auto');
  const [description, setDescription] = useState('');
  const [referenceUrl, setReferenceUrl] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [voice, setVoice] = useState('am_michael');
  const [permission, setPermission] = useState(false);
  const [wantLogin, setWantLogin] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginUrl, setLoginUrl] = useState('');
  const website = mode === 'website';

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
      file: website || file ? null : 'Choose a video to upload.',
      description: mode === 'auto' || description.trim() ? null : (website ? 'Describe the video you want.' : 'Describe how you want this video edited.'),
      url: !website || siteUrl.trim() ? null : 'Paste the website link.',
      permission: !website || permission ? null : 'Tick the box to confirm you may record this website.',
      login: !website || !wantLogin || (username.trim() && password) ? null : 'Enter the username and password, or untick "This website needs a login".',
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
      if (website) {
        // The password never leaves this page unlocked: it is sealed for the video editor only.
        const login = wantLogin ? await sealLogin(status.worker.loginKey, username.trim(), password) : null;
        setPassword('');
        await api.startVideoJob({ mode, url: siteUrl.trim(), description: description.trim(), voice, permission, platform, cta: cta.trim(), style, login, loginUrl: loginUrl.trim() || undefined });
        setNotice({ ok: true, text: status.worker.online ? 'Started. The video editor is exploring the website - you will approve the plan and voiceover before anything is recorded.' : "Saved. It starts when the video editor is back online." });
        setDescription('');
        setSiteUrl('');
        setUsername('');
        setWantLogin(false);
        onStarted();
        return;
      }
      const contentType = file.type || 'video/mp4';
      const { job, uploadUrl } = await api.startVideoJob({
        name: file.name, bytes: file.size, contentType, platform, cta: cta.trim(), style, both_formats: both,
        mode, ...(mode === 'custom' ? { description: description.trim(), referenceUrl: referenceUrl.trim() || undefined } : {}),
      });
      setUploadPct(0);
      await putFile(uploadUrl, file, contentType, setUploadPct);
      await api.videoUploaded(job.id);
      setNotice({ ok: true, text: status.worker.online ? 'Uploaded. The video editor is on it - progress shows below.' : "Uploaded. The video editor is offline right now; your job will start when it's back." });
      setFile(null);
      setCta('');
      setDescription('');
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
      <fieldset>
        <legend className="text-sm font-medium mb-1.5">What do you want to make? <FieldTag required /></legend>
        <div className="grid sm:grid-cols-3 gap-2">
          {MODES.map((m) => (
            <button type="button" key={m.value} onClick={() => { setMode(m.value); setErrors({}); }} className={choice(mode === m.value)} aria-pressed={mode === m.value}>
              <span className="block font-medium">{m.label}</span><span className="text-xs text-[var(--color-text-muted)]">{m.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {mode === 'custom' && (
        <div className="space-y-3">
          <div>
            <label htmlFor="video-description" className="block text-sm font-medium mb-1.5">Describe how you want this video edited <FieldTag required /></label>
            <textarea id="video-description" rows={4} value={description} maxLength={2000} onChange={(e) => { setDescription(e.target.value); setErrors((x) => ({ ...x, description: null })); }}
              placeholder='e.g. "Start with the part about delivery, cut the intro, zoom in when I say the price, add a title saying 3 reasons to order, show my jollof photo when I mention it."' className={input} />
            <FieldError>{errors.description}</FieldError>
          </div>
          <div>
            <label htmlFor="video-reference" className="block text-sm font-medium mb-1.5">Reference website <FieldTag /></label>
            <input id="video-reference" value={referenceUrl} onChange={(e) => setReferenceUrl(e.target.value)} placeholder="e.g. yourbusiness.com - for screenshots and the look" className={input} />
            <FieldError>{errors.referenceUrl}</FieldError>
          </div>
        </div>
      )}

      {website && (
        <div className="space-y-3">
          <div>
            <label htmlFor="video-site" className="block text-sm font-medium mb-1.5">Website link <FieldTag required /></label>
            <input id="video-site" value={siteUrl} onChange={(e) => { setSiteUrl(e.target.value); setErrors((x) => ({ ...x, url: null })); }} placeholder="https://yourbusiness.com" className={input} />
            <FieldError>{errors.url}</FieldError>
          </div>
          <div>
            <label htmlFor="video-site-description" className="block text-sm font-medium mb-1.5">Describe the video you want <FieldTag required /></label>
            <textarea id="video-site-description" rows={3} value={description} maxLength={2000} onChange={(e) => { setDescription(e.target.value); setErrors((x) => ({ ...x, description: null })); }}
              placeholder='e.g. "A 60-second TikTok showing how customers order from my app"' className={input} />
            <FieldError>{errors.description}</FieldError>
          </div>
          <div>
            <label htmlFor="video-voice" className="block text-sm font-medium mb-1.5">Voiceover voice <FieldTag required /></label>
            <select id="video-voice" value={voice} onChange={(e) => setVoice(e.target.value)} className={input}>
              {(status.voices || []).map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">A free voice made on the video editor itself (no paid voice service).</p>
          </div>
          <div className="rounded-md border border-[var(--color-border)] p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={wantLogin} onChange={(e) => setWantLogin(e.target.checked)} /> This website needs a login to show it <FieldTag /></label>
            {wantLogin && (
              <>
                <p className="text-xs text-[var(--color-warning)]">Use a <strong>demo account</strong> with sample data, not your real one - whatever is on screen after logging in can appear in the video. The details are locked in your browser so only the video editor can read them, used for this video only, never saved, and wiped when it's done. 2-factor codes and captchas can't be entered.</p>
                <div className="grid sm:grid-cols-2 gap-2">
                  <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username or email" autoComplete="off" aria-label="Website username" className={input} />
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" autoComplete="new-password" aria-label="Website password" className={input} />
                </div>
                <input value={loginUrl} onChange={(e) => setLoginUrl(e.target.value)} placeholder="Login page link (optional)" aria-label="Login page link" className={input} />
                {!status.worker.loginKey && <p className="text-xs text-[var(--color-danger)]">The video editor is offline, so login details can't be locked for it right now.</p>}
              </>
            )}
            <FieldError>{errors.login}</FieldError>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={permission} onChange={(e) => { setPermission(e.target.checked); setErrors((x) => ({ ...x, permission: null })); }} className="mt-1" />
            <span>I own this website or have permission to record it. <FieldTag required /><span className="block text-xs text-[var(--color-text-muted)]">The video editor only looks: it never buys, submits forms, deletes or changes anything.</span></span>
          </label>
          <FieldError>{errors.permission}</FieldError>
        </div>
      )}

      {!website && (
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
      )}

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
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {website ? 'Explore and plan' : mode === 'custom' ? 'Upload and plan' : 'Upload and edit'}
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

/** The plan, in plain words, with Approve / Change it. */
function PlanReview({ job, workerOnline, onChange }) {
  const plan = job.plan;
  const [changing, setChanging] = useState(false);
  const [text, setText] = useState(job.request?.description || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function act(fn) {
    setBusy(true);
    setError(null);
    try { await fn(); onChange(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <div className="mt-3 rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5 p-3 space-y-3 text-sm">
      <div className="font-medium">{plan.kind === 'website' ? `Plan: "${plan.title}"` : 'Your edit plan'} {plan.estimatedSeconds ? <span className="text-xs text-[var(--color-text-muted)]">· about {Math.round(plan.estimatedSeconds)} seconds</span> : null}</div>
      {plan.summary?.length > 0 && <ul className="list-disc pl-5 space-y-0.5">{plan.summary.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      {plan.kind === 'website' && (
        <ol className="space-y-2">
          {plan.scenes.map((sc, i) => (
            <li key={i} className="flex gap-3 items-start">
              {plan.thumbUrls?.[sc.page] && <img src={plan.thumbUrls[sc.page]} alt="" className="w-16 h-auto rounded border border-[var(--color-border)] shrink-0" />}
              <div>
                <div className="text-xs text-[var(--color-text-muted)]">Scene {i + 1} · {sc.show === 'scroll' ? 'scroll down the page' : sc.show === 'click' ? 'click a feature' : 'show the page'}</div>
                <div>"{sc.narration}"</div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {plan.cant_do?.length > 0 && (
        <div className="text-[var(--color-warning)]"><div className="font-medium">Can't do:</div><ul className="list-disc pl-5">{plan.cant_do.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
      )}
      {plan.notes?.length > 0 && <ul className="text-xs text-[var(--color-text-muted)] list-disc pl-5">{plan.notes.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      {changing ? (
        <div className="space-y-2">
          <label htmlFor={`revise-${job.id}`} className="block text-xs font-medium">What should change? <FieldTag required /></label>
          <textarea id={`revise-${job.id}`} rows={3} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} className={input} />
          <div className="flex gap-2">
            <button type="button" disabled={busy || !text.trim()} onClick={() => act(() => api.reviseVideoJob(job.id, text.trim()))} className="px-3 py-1.5 rounded-md text-sm font-medium bg-[var(--color-accent)] text-black disabled:opacity-50">Plan again</button>
            <button type="button" onClick={() => setChanging(false)} className="px-3 py-1.5 text-sm text-[var(--color-text-muted)]">Back</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => act(() => api.approveVideoJob(job.id))} className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-[var(--color-accent)] text-black disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} Approve and make it
          </button>
          <button type="button" disabled={busy} onClick={() => setChanging(true)} className="px-3 py-2 rounded-md text-sm border border-[var(--color-border)]">Change it</button>
        </div>
      )}
      {!workerOnline && <p className="text-xs text-[var(--color-text-muted)]">The video editor is offline - after you approve, it starts when it's back.</p>}
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}

/** Website login again (after a restart, or wrong details). */
function LoginAgain({ job, loginKey, onDone }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function send(e) {
    e.preventDefault();
    if (!username.trim() || !password) return setError('Enter the username and password.');
    setBusy(true);
    setError(null);
    try {
      const login = await sealLogin(loginKey, username.trim(), password);
      setPassword('');
      await api.videoJobLogin(job.id, login);
      onDone();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={send} noValidate className="mt-2 space-y-2">
      <p className="text-xs text-[var(--color-text-muted)]">Enter the website login again (a demo account is best). It is locked for the video editor and never saved.</p>
      <div className="grid sm:grid-cols-2 gap-2">
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username or email" autoComplete="off" aria-label="Website username" className={input} />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" autoComplete="new-password" aria-label="Website password" className={input} />
      </div>
      <button type="submit" disabled={busy} className="px-3 py-1.5 rounded-md text-sm font-medium bg-[var(--color-accent)] text-black disabled:opacity-50">Try again</button>
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
    </form>
  );
}

function JobCard({ job, stages, workerOnline, keepDays, onChange, loginKey }) {
  const [busy, setBusy] = useState(false);
  const outputs = job.result?.outputs || [];
  const videos = outputs.filter((o) => o.role === 'video');
  const test = outputs.find((o) => o.role === 'test_clip');
  const preview = videos[0] || test;
  const title = job.kind === 'test_clip' ? '7-second test clip' : job.mode === 'website' ? (job.plan?.title || job.request?.url) : job.original_name;
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
            {job.mode === 'website' ? 'website video · ' : job.mode === 'custom' ? 'my way · ' : ''}{job.kind !== 'test_clip' && `${job.answers?.platform || ''} · ${job.answers?.style === 'captions' ? 'captions and graphics' : 'clean cut'} · `}
            {new Date(job.created_at).toLocaleString()}
          </div>
        </div>
        {job.status === 'done' && <span className="flex items-center gap-1 text-xs font-medium text-emerald-600"><CheckCircle2 size={13} /> Ready</span>}
        {job.status === 'failed' && <span className="flex items-center gap-1 text-xs font-medium text-[var(--color-danger)]"><AlertCircle size={13} /> Didn't finish</span>}
        {job.status === 'canceled' && <span className="text-xs text-[var(--color-text-muted)]">Canceled</span>}
        {job.status === 'awaiting_approval' && <span className="text-xs font-medium text-[var(--color-warning)]">Plan ready - your approval needed</span>}
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
      {job.status === 'failed' && job.needsLogin && <LoginAgain job={job} loginKey={loginKey} onDone={onChange} />}
      {job.status === 'awaiting_approval' && job.plan && <PlanReview job={job} workerOnline={workerOnline} onChange={onChange} />}

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
