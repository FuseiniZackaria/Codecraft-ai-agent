const config = require('../../config');

/**
 * A business's brand kit (migration 0011, table brand_kits): two or more
 * colours, a font, how the brand talks, a logo and a "B-roll kit" of photos
 * and clips. The video editor asks once for two colours and a font when none
 * are saved, then uses them for every video's captions and graphics.
 *
 * Fonts: the ones HyperFrames bundles, so a render never has to fetch fonts.
 */

const FONTS = [
  'Inter', 'Montserrat', 'Outfit', 'Nunito', 'Oswald', 'League Gothic', 'Archivo Black', 'Poppins', 'Roboto',
  'Open Sans', 'Lato', 'Playfair Display', 'EB Garamond', 'Space Mono', 'IBM Plex Mono', 'JetBrains Mono', 'Source Code Pro', 'Noto Sans JP',
];
const MAX_BROLL = 30;

let client;
function db() {
  if (client !== undefined) return client;
  const useSupabase = process.env.CC_FORCE_MEMORY_STORE !== '1' && config.supabase.url && config.supabase.serviceKey;
  client = useSupabase ? require('@supabase/supabase-js').createClient(config.supabase.url, config.supabase.serviceKey) : null;
  return client;
}
const mem = new Map();

function check(error, where) {
  if (!error) return;
  if (/does not exist|schema cache/i.test(error.message)) {
    const err = new Error('The brand kit table is missing - run backend/database/migrations/0011_video_editor.sql in Supabase.');
    err.code = 'MIGRATION_MISSING';
    throw err;
  }
  throw new Error(`brand kit (${where}): ${error.message}`);
}

const EMPTY = { colors: [], font: null, voice: null, logo_key: null, broll: [] };

async function get(workspaceId) {
  if (!workspaceId) return { ...EMPTY, ready: false };
  let row;
  if (!db()) row = mem.get(workspaceId) || null;
  else {
    const { data, error } = await db().from('brand_kits').select('*').eq('workspace_id', workspaceId).maybeSingle();
    check(error, 'get');
    row = data;
  }
  const kit = { ...EMPTY, ...(row || {}) };
  kit.colors = Array.isArray(kit.colors) ? kit.colors : [];
  kit.broll = Array.isArray(kit.broll) ? kit.broll : [];
  // "Ready" = what branded captions need: two colours and a font.
  kit.ready = kit.colors.length >= 2 && !!kit.font;
  return kit;
}

async function save(workspaceId, patch, { userId = null } = {}) {
  const current = await get(workspaceId);
  const row = {
    workspace_id: workspaceId,
    colors: patch.colors ?? current.colors,
    font: patch.font !== undefined ? patch.font : current.font,
    voice: patch.voice !== undefined ? patch.voice : current.voice,
    logo_key: patch.logo_key !== undefined ? patch.logo_key : current.logo_key,
    broll: patch.broll ?? current.broll,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };
  if (!db()) mem.set(workspaceId, row);
  else {
    const { error } = await db().from('brand_kits').upsert(row, { onConflict: 'workspace_id' });
    check(error, 'save');
  }
  return get(workspaceId);
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Colours, font and voice from the form. Returns { patch, fieldErrors, errors }. */
function validate(body = {}) {
  const patch = {};
  const fieldErrors = {};
  if (body.colors !== undefined) {
    const colors = (Array.isArray(body.colors) ? body.colors : []).map((c) => String(c || '').trim()).filter(Boolean);
    if (colors.length < 2) fieldErrors.colors = 'Choose two brand colours.';
    else if (colors.length > 5) fieldErrors.colors = 'Use at most five brand colours.';
    else if (colors.some((c) => !HEX.test(c))) fieldErrors.colors = 'Colours must look like #E4572E.';
    else patch.colors = colors.map((c) => c.toUpperCase());
  }
  if (body.font !== undefined) {
    if (!FONTS.includes(body.font)) fieldErrors.font = 'Choose one of the listed fonts.';
    else patch.font = body.font;
  }
  if (body.voice !== undefined) {
    const v = String(body.voice || '').trim();
    if (v.length > 500) fieldErrors.voice = 'Keep the brand voice under 500 characters.';
    else patch.voice = v || null;
  }
  return { patch, fieldErrors, errors: Object.values(fieldErrors) };
}

/** Bytes the brand kit's files use (for the storage limit). */
async function bytesUsed(workspaceId = null) {
  const rows = !db()
    ? (workspaceId ? [mem.get(workspaceId)].filter(Boolean) : [...mem.values()])
    : await (async () => {
      let q = db().from('brand_kits').select('broll');
      if (workspaceId) q = q.eq('workspace_id', workspaceId);
      const { data, error } = await q;
      if (error) return [];
      return data || [];
    })();
  return rows.reduce((sum, r) => sum + (Array.isArray(r.broll) ? r.broll : []).reduce((s, b) => s + Number(b.bytes || 0), 0), 0);
}

function _reset() { mem.clear(); }

module.exports = { FONTS, MAX_BROLL, get, save, validate, bytesUsed, _reset };
