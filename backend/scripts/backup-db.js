#!/usr/bin/env node
/**
 * backup-db.js - read-only snapshot of every CodeCraft table to JSON.
 *
 * - Uses the existing SUPABASE_URL / SUPABASE_SERVICE_KEY from backend/.env.
 * - SELECTs only. No INSERT, UPDATE, DELETE anywhere - verified by eye and
 *   by the fact we never call .insert/.update/.delete anywhere below.
 * - Paginates in 1,000-row pages so a 10K+ row table is never truncated.
 * - Writes one JSON file per table into
 *     C:\Users\Dell\codecraft-ai\backups\<YYYY-MM-DD-pre-workspaces>\
 *   plus a _manifest.json summarizing counts.
 * - Treats auth.users specially: only id, email, created_at, last_sign_in_at
 *   are exported. Password hashes are NEVER read or written.
 *
 * Usage: node backend/scripts/backup-db.js
 *        node backend/scripts/backup-db.js --label=my-tag
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const PAGE_SIZE = 1000;

// Tables the app actually uses - sourced from backend/database/schema.sql.
// Order doesn't matter for a backup; keeping it alphabetical for readability.
const TABLES = [
  'agent_memory',
  'agents',
  'assistant_usage_daily',
  'audit_log',
  'briefing_articles',
  'briefing_runs',
  'business_profile',       // may not exist yet pre-migration; handled below
  'chat_messages',
  'conversations',
  'embeddings',
  'long_term_memory',
  'messages',
  'outreach_threads',
  'plugins',
  'reflections',
  'roles',
  'rls_shadow_log',         // only exists post-migration; handled below
  'scheduled_workflows',
  'skills',
  'tasks',
  'telegram_messages',
  'user_roles',
  'whatsapp_messages',
  'workflow_connections',   // reserved for Phase 2; may not exist yet
  'workflow_definitions',
  'workflow_members',       // reserved for Phase 2; may not exist yet
  'workflow_runs',
  'workspace_connections',  // may not exist yet pre-migration
  'workspace_members',      // may not exist yet pre-migration
  'workspaces',             // may not exist yet pre-migration
];

function flag(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : def;
}

function today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function fetchAll(client, table) {
  const rows = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error, status } = await client
      .from(table)
      .select('*')
      .range(from, to);
    if (error) {
      // 42P01 = undefined_table in Postgres; treat it as "table absent" rather
      // than a backup failure, so this script works both before and after the
      // workspaces migration.
      // Treat "table absent" as a skip, not a backup failure, so this script
      // works both pre- and post-migration. Supabase REST reports it in two
      // different ways depending on the layer that produced the error:
      //   - raw PG: SQLSTATE 42P01, message "relation ... does not exist"
      //   - PostgREST cache: "Could not find the table '...' in the schema cache"
      if (
        error.code === '42P01' ||
        /does not exist/i.test(error.message) ||
        /could not find the table/i.test(error.message)
      ) {
        return { rows: [], skipped: 'table_absent' };
      }
      throw new Error(`${table}: ${error.message} (status ${status})`);
    }
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
    if (from > 10_000_000) throw new Error(`${table}: pagination safety limit hit`);
  }
  return { rows };
}

async function fetchAuthUsersSafe(client) {
  // supabase.auth.admin.listUsers returns the entire auth.users row, which
  // includes hashed_password / encrypted_password-adjacent metadata. Strip
  // down to the only fields a workspace backup needs. Password hashes are
  // never read into memory beyond the API response's lifetime, and we never
  // write them to disk.
  const kept = [];
  let page = 1;
  const perPage = 1000;
  while (true) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`auth.users: ${error.message}`);
    const users = data?.users || [];
    for (const u of users) {
      kept.push({
        id: u.id,
        email: u.email || null,
        created_at: u.created_at || null,
        last_sign_in_at: u.last_sign_in_at || null,
      });
    }
    if (users.length < perPage) break;
    page += 1;
    if (page > 50) break;
  }
  return kept;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('[backup-db] SUPABASE_URL / SUPABASE_SERVICE_KEY missing in backend/.env');
    process.exit(1);
  }

  const label = flag('label', 'pre-workspaces');
  const outDir = path.join(__dirname, '..', '..', 'backups', `${today()}-${label}`);
  fs.mkdirSync(outDir, { recursive: true });

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const summary = [];

  for (const table of TABLES) {
    process.stdout.write(`  ${table.padEnd(28)} `);
    try {
      const { rows, skipped } = await fetchAll(client, table);
      if (skipped === 'table_absent') {
        process.stdout.write('(absent, skipped)\n');
        summary.push({ table, rows: 0, status: 'absent' });
        continue;
      }
      const file = path.join(outDir, `${table}.json`);
      fs.writeFileSync(file, JSON.stringify(rows, null, 2));
      process.stdout.write(`${rows.length} rows\n`);
      summary.push({ table, rows: rows.length, status: 'ok' });
    } catch (err) {
      process.stdout.write(`FAILED: ${err.message}\n`);
      summary.push({ table, rows: 0, status: `error: ${err.message}` });
    }
  }

  process.stdout.write(`  ${'auth.users (sanitized)'.padEnd(28)} `);
  try {
    const users = await fetchAuthUsersSafe(client);
    fs.writeFileSync(path.join(outDir, 'auth_users_sanitized.json'), JSON.stringify(users, null, 2));
    process.stdout.write(`${users.length} rows\n`);
    summary.push({ table: 'auth.users (id, email, created_at, last_sign_in_at only)', rows: users.length, status: 'ok' });
  } catch (err) {
    process.stdout.write(`FAILED: ${err.message}\n`);
    summary.push({ table: 'auth.users', rows: 0, status: `error: ${err.message}` });
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    supabaseUrl: url.replace(/:\/\/[^@]+@/, '://[redacted]@'), // in case anyone added auth
    label,
    pageSize: PAGE_SIZE,
    tables: summary,
  };
  fs.writeFileSync(path.join(outDir, '_manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`\nBackup folder: ${outDir}`);
  console.log('Manifest:     _manifest.json');

  // Pretty summary table for the terminal.
  const col1 = Math.max(...summary.map((s) => s.table.length), 'Table'.length);
  const col2 = Math.max(...summary.map((s) => String(s.rows).length), 'Rows'.length);
  console.log('');
  console.log(`${'Table'.padEnd(col1)}  ${'Rows'.padStart(col2)}  Status`);
  console.log(`${'-'.repeat(col1)}  ${'-'.repeat(col2)}  ------`);
  for (const row of summary) {
    console.log(`${row.table.padEnd(col1)}  ${String(row.rows).padStart(col2)}  ${row.status}`);
  }
}

main().catch((err) => {
  console.error('[backup-db] FAILED:', err.message);
  process.exit(1);
});
