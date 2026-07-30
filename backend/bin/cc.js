#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { Installer } = require('../core/installer/Installer');
const { SkillManager } = require('../core/installer/SkillManager');
const { Registry } = require('../core/installer/Registry');
const bus = require('../core/eventBus');

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', gray: '\x1b[90m',
};
const ok = (s) => `${c.green}${s}${c.reset}`;
const err = (s) => `${c.red}${s}${c.reset}`;
const info = (s) => `${c.cyan}${s}${c.reset}`;
const dim = (s) => `${c.gray}${s}${c.reset}`;

function printLiveEvents(matchTarget) {
  const onEvent = (event) => {
    if (event.actor !== 'installer' && event.actor !== 'skill-manager') return;
    if (matchTarget && event.target !== matchTarget && event.metadata?.taskId !== matchTarget) return;
    console.log(`  ${dim(new Date(event.at).toLocaleTimeString())} ${info(event.action)} ${dim(event.target || '')}`);
  };
  bus.on('event', onEvent);
  return () => bus.off('event', onEvent);
}

async function cmdInstall(source, permissionFlags) {
  const installer = new Installer();

  const { detectSource } = require('../core/installer/SourceDetector');
  const { Downloader } = require('../core/installer/Downloader');
  const { Manifest } = require('../core/installer/Manifest');
  const registry = new Registry();

  console.log(`Resolving ${info(source)}...`);
  const parsed = detectSource(source);
  const downloader = new Downloader();
  const packageDir = parsed.type === 'registry' ? await downloader.fetch(registry.resolveSource(parsed.id)) : await downloader.fetch(parsed);
  const manifest = Manifest.load(packageDir);

  console.log(`\n${c.bold}${manifest.name}${c.reset} v${manifest.version} by ${manifest.author}`);
  console.log(dim(manifest.description));
  if (manifest.permissions.length) {
    console.log(`\nThis skill requests: ${manifest.permissions.map((p) => c.yellow + p + c.reset).join(', ')}`);
    if (!permissionFlags.includes('--yes-all-permissions')) {
      console.log(dim('Re-run with --yes-all-permissions to approve and install non-interactively.'));
      return;
    }
  }

  console.log(`\nInstalling ${info(manifest.id)}...\n`);
  const stopListening = printLiveEvents(manifest.id);
  try {
    await installer.install(source, { approvedPermissions: manifest.permissions });
    console.log(`\n${ok('✓')} Installed ${c.bold}${manifest.id}${c.reset} v${manifest.version}`);
  } catch (e) {
    console.log(`\n${err('✗')} Install failed: ${e.message}`);
    process.exitCode = 1;
  } finally {
    stopListening();
  }
}

async function cmdUninstall(id) {
  const skillManager = new SkillManager();
  try {
    await skillManager.remove(id);
    console.log(`${ok('✓')} Removed ${id}`);
  } catch (e) {
    console.log(`${err('✗')} ${e.message}`);
    process.exitCode = 1;
  }
}

async function cmdEnable(id) {
  const skillManager = new SkillManager();
  try {
    await skillManager.enable(id);
    console.log(`${ok('✓')} Enabled ${id}`);
  } catch (e) {
    console.log(`${err('✗')} ${e.message}`);
    process.exitCode = 1;
  }
}

async function cmdDisable(id) {
  const skillManager = new SkillManager();
  try {
    await skillManager.disable(id);
    console.log(`${ok('✓')} Disabled ${id}`);
  } catch (e) {
    console.log(`${err('✗')} ${e.message}`);
    process.exitCode = 1;
  }
}

async function cmdUpdate(id) {
  const skillManager = new SkillManager();
  try {
    const result = await skillManager.update(id);
    if (!result.updated) {
      console.log(dim(`Already up to date (${result.reason})`));
    } else {
      console.log(`${ok('✓')} Updated ${id}: v${result.from} -> v${result.to}`);
    }
  } catch (e) {
    console.log(`${err('✗')} ${e.message}`);
    process.exitCode = 1;
  }
}

async function cmdRepair(id) {
  const skillManager = new SkillManager();
  try {
    const result = await skillManager.repair(id);
    console.log(result.repaired ? `${ok('✓')} Repaired ${id}` : dim(`No repair needed for ${id}`));
  } catch (e) {
    console.log(`${err('✗')} ${e.message}`);
    process.exitCode = 1;
  }
}

async function cmdSearch(query) {
  const registry = new Registry();
  const results = registry.search(query);
  if (!results.length) return console.log(dim('No skills found.'));
  for (const s of results) {
    console.log(`${c.bold}${s.id}${c.reset}  ${dim('v' + s.version)}  ${s.description}`);
  }
}

async function cmdList() {
  const skillManager = new SkillManager();
  const skills = await skillManager.list();
  if (!skills.length) return console.log(dim('No skills installed.'));
  for (const s of skills) {
    const statusColor = s.status === 'enabled' ? ok(s.status) : dim(s.status);
    console.log(`${c.bold}${s.id}${c.reset}  v${s.version}  [${statusColor}]  ${dim(s.description || '')}`);
  }
}

async function cmdInfo(id) {
  const skillManager = new SkillManager();
  try {
    const s = await skillManager.info(id);
    console.log(`${c.bold}${s.name}${c.reset} (${s.id}) v${s.version}`);
    console.log(`Author: ${s.author}`);
    console.log(`Status: ${s.status === 'enabled' ? ok(s.status) : dim(s.status)}`);
    console.log(`Source: ${s.sourceType} (${s.sourceInput})`);
    console.log(`Permissions: ${s.permissions.join(', ') || dim('none')}`);
    console.log(`Dependencies: ${s.manifest.dependencies.join(', ') || dim('none')}`);
    console.log(`Installed: ${s.installedAt}`);
  } catch (e) {
    console.log(`${err('✗')} ${e.message}`);
    process.exitCode = 1;
  }
}

async function main() {
  const [, , cmd, ...rest] = process.argv;

  switch (cmd) {
    case 'install':
      return cmdInstall(rest[0], rest.slice(1));
    case 'uninstall':
      return cmdUninstall(rest[0]);
    case 'enable':
      return cmdEnable(rest[0]);
    case 'disable':
      return cmdDisable(rest[0]);
    case 'update':
      return cmdUpdate(rest[0]);
    case 'repair':
      return cmdRepair(rest[0]);
    case 'search':
      return cmdSearch(rest[0] || '');
    case 'list':
      return cmdList();
    case 'info':
      return cmdInfo(rest[0]);
    default:
      console.log(`${c.bold}cc${c.reset} - CodeCraft AI Skill Installer CLI\n`);
      console.log('Usage:');
      console.log('  cc install <source> [--yes-all-permissions]');
      console.log('  cc uninstall <id>');
      console.log('  cc enable <id>');
      console.log('  cc disable <id>');
      console.log('  cc update <id>');
      console.log('  cc repair <id>');
      console.log('  cc search <query>');
      console.log('  cc list');
      console.log('  cc info <id>');
  }
}

main().catch((e) => {
  console.error(err(`Unexpected error: ${e.message}`));
  process.exit(1);
});
