#!/usr/bin/env node
/**
 * check-rls.js - checks that nobody can read CodeCraft's tables with the
 * PUBLIC key that ships inside the website (VITE_SUPABASE_ANON_KEY).
 *
 * For every table it asks Supabase, as an anonymous visitor, for one row.
 * "locked" = no rows came back (row level security on, as it should be).
 * "OPEN"   = rows came back: anyone could read that table - run migration 0010.
 *
 * Read-only: it only tries to SELECT. It never prints keys or row contents.
 *
 * Usage (from the repo root):  node backend/scripts/check-rls.js
 * Reads SUPABASE_URL from backend/.env and the public key from frontend/.env
 * (VITE_SUPABASE_ANON_KEY), or SUPABASE_ANON_KEY if you set it yourself.
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function readFrontendEnv(name) {
  try {
    const text = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', '.env'), 'utf8');
    const line = text.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : null;
  } catch {
    return null;
  }
}

/** Table names from the schema and every migration. */
function tableNames() {
  const dir = path.join(__dirname, '..', 'database');
  const files = [path.join(dir, 'schema.sql'), ...fs.readdirSync(path.join(dir, 'migrations')).filter((f) => f.endsWith('.sql')).map((f) => path.join(dir, 'migrations', f))];
  const names = new Set();
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const sql = fs.readFileSync(f, 'utf8');
    for (const m of sql.matchAll(/create table (?:if not exists )?(?:public\.)?([a-z_][a-z0-9_]*)/gi)) names.add(m[1].toLowerCase());
  }
  return [...names].sort();
}

(async () => {
  const url = process.env.SUPABASE_URL || readFrontendEnv('VITE_SUPABASE_URL');
  const anonKey = process.env.SUPABASE_ANON_KEY || readFrontendEnv('VITE_SUPABASE_ANON_KEY');
  if (!url || !anonKey) {
    console.error('Need SUPABASE_URL (backend/.env) and VITE_SUPABASE_ANON_KEY (frontend/.env).');
    process.exit(1);
  }
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const open = [];
  let locked = 0;
  let missing = 0;
  for (const table of tableNames()) {
    const { data, error } = await anon.from(table).select('*').limit(1);
    if (error) {
      if (/does not exist|schema cache|not found/i.test(error.message)) { missing += 1; continue; }
      locked += 1; // permission denied = locked
      continue;
    }
    if (data && data.length) open.push(table);
    else locked += 1;
  }
  console.log(`Checked tables with the public key: ${locked} locked, ${missing} not created, ${open.length} OPEN. (An empty table always looks locked.)`);
  if (open.length) {
    console.log(`OPEN (anyone with the website's public key can read these): ${open.join(', ')}`);
    console.log('Fix: run backend/database/migrations/0010_multi_client.sql in Supabase -> SQL Editor, then run this again.');
    process.exit(2);
  }
  console.log('All good: no table can be read with the public key.');
})().catch((err) => {
  console.error(`check failed: ${err.message}`);
  process.exit(1);
});
