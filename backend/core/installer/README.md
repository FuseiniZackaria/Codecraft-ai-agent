# Universal Skill Installer

A real, tested subsystem for installing/managing skills (tools and agents)
into CodeCraft AI at runtime, with no restart required.

## What's real vs. what's scoped out

**Real and tested** (18 automated tests across `tests/installer.test.js` +
`tests/orchestrator.test.js`, run via `npm test`):
- The full 12-stage pipeline: detect → download → verify → manifest →
  validate → dependencies → permissions → copy → register → activate
- Local folders, local `.zip` files, remote `.zip` URLs, GitHub repos
  (`github:user/repo`, tries `main` then `master`)
- Real SHA-256 checksum verification
- Real dependency classification + circular dependency detection
- Real permission enforcement (nothing installs without explicit approval)
- Real dynamic loading - a skill's `tools` get registered into the actual
  running `ToolRegistry` and are immediately callable; a skill's `agent`
  (extending `global.CodeCraftSDK.BaseAgent`) gets registered into the
  actual agent registry
- Full lifecycle: enable / disable / remove / reinstall / repair / update /
  backup / restore / export / import
- Automatic rollback on failure at any stage (files **and** the persisted
  database record - this was a real bug caught during testing and fixed)
- CLI (`bin/cc.js`) and a React GUI (`/skills`) with a live install console
  fed by the same SSE event bus that powers the Agent Console

**Deliberately not built, and why:**
- **No TypeScript/Electron/WebSockets** - this is a JS web app end-to-end;
  those would fork the whole project's tooling for one subsystem. SSE
  (already built for the Agent Console) covers the same "live push" need.
- **No hosted `registry.codecraft.ai`** - it doesn't exist. `Registry.js`
  reads a local index with one real, working sample skill (`greeting-skill`),
  designed so a real HTTP registry can replace it later with no caller changes.
- **No digital signature verification** - `SignatureVerifier.verifySignature()`
  honestly returns `{ signed: false }`. No certificate authority exists yet.
- **No "OpenClaw-compatible skills"** - not a verified, documented format,
  so no fabricated compatibility claim.
- **No generated sequence/class diagrams** - this file plus the inline
  JSDoc in every class (each states its single responsibility) are the
  practical equivalent for a project this size.

## Architecture

```
core/installer/
  SourceDetector.js       classifies an install string into a source type
  Downloader.js            fetches/stages the package for that source
  SignatureVerifier.js     checksum (real) + signature (stub) verification
  Manifest.js               parses/validates manifest.json
  DependencyResolver.js    classifies deps satisfied/missing, detects cycles
  PermissionManager.js     enforces explicit permission approval
  Activator.js              dynamic require() + register/unregister at runtime
  Registry.js                marketplace client (local index today)
  Installer.js               orchestrates the pipeline, owns rollback
  SkillManager.js            post-install lifecycle operations
  sdk.js                     exposes BaseAgent to skill code via a global
```

Each class has exactly one job. `Installer.js` is the only place that knows
the order they run in - it never contains business logic belonging to the
orchestrator/agents system, it only ever installs and activates code.

## Manifest format

```json
{
  "id": "marketing-agent",
  "name": "Marketing Agent",
  "version": "1.0.0",
  "author": "CodeCraft",
  "description": "...",
  "entry": "agent/index.js",
  "minimumCoreVersion": "1.0.0",
  "dependencies": ["browser", "memory", "search"],
  "permissions": ["internet", "filesystem"],
  "tools": ["browser", "search"],
  "events": ["skill.loaded", "skill.enabled"]
}
```

## Entry file contract

```js
// agent/index.js
module.exports = {
  tools: [
    { name: 'myTool', permission: null, irreversible: false, async run(args) { /* ... */ } },
  ],
  // optional - extends the real BaseAgent, gets registered into the live agent registry
  agent: new (class extends global.CodeCraftSDK.BaseAgent { })(),
};
```

## CLI

```bash
npm run cc -- install registry:greeting-skill --yes-all-permissions
npm run cc -- list
npm run cc -- info greeting-skill
npm run cc -- disable greeting-skill
npm run cc -- enable greeting-skill
npm run cc -- update greeting-skill
npm run cc -- repair greeting-skill
npm run cc -- uninstall greeting-skill
npm run cc -- search greeting
```

(Or `npm link` inside `backend/` to get a real global `cc` command.)

## Important operational note

Each `cc` command is a **separate process**. Without `SUPABASE_URL` /
`SUPABASE_SERVICE_KEY` configured, installed-skill state lives in memory and
does **not** persist between CLI invocations or survive a server restart -
same constraint that already applies to tasks/chat elsewhere in this app,
just more acutely felt here since CLI usage is inherently multi-process.
Configure Supabase for skill management to actually work across commands.

## Try it

The sample `greeting-skill` has zero dependencies/permissions, so it
installs with no approval prompts - the fastest way to see the whole
pipeline run for real:

```bash
npm run cc -- install registry:greeting-skill
npm run cc -- list
```

Or from the GUI: **Skills → Marketplace → Install** on "Greeting Skill".
