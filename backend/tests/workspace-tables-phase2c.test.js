// Phase 2.3c coverage test: every remaining table that wasn't stamped in
// Phase 2.3b (scheduled_workflows, workflow_definitions, workflow_runs,
// briefing_runs, briefing_articles, skills, long_term_memory) now carries
// workspace_id end-to-end, and legacy rows (workspace_id = null) stay
// visible to a workspace-scoped reader.
//
// Runs against the in-memory store so it's self-contained and doesn't
// need a live Supabase connection.

process.env.SUPABASE_URL = '';
process.env.SUPABASE_SERVICE_KEY = '';

const assert = require('assert');
const memory = require('../memory');
const { v4: uuid } = require('uuid');
const { clearShadowLog } = require('../memory/workspaceGuard');

async function main() {
  const WS_A = '11111111-1111-1111-1111-111111111111';
  const WS_B = '22222222-2222-2222-2222-222222222222';

  clearShadowLog();

  // --- scheduled_workflows ---------------------------------------------------
  const wfA = { id: uuid(), name: 'A workflow', goal: 'ping A', scheduleType: 'interval',
    intervalMinutes: 60, enabled: true, lastRunAt: null, createdAt: new Date().toISOString(),
    workspace_id: WS_A };
  const wfB = { id: uuid(), name: 'B workflow', goal: 'ping B', scheduleType: 'interval',
    intervalMinutes: 60, enabled: true, lastRunAt: null, createdAt: new Date().toISOString(),
    workspace_id: WS_B };
  const wfLegacy = { id: uuid(), name: 'legacy workflow', goal: 'ping legacy', scheduleType: 'interval',
    intervalMinutes: 60, enabled: true, lastRunAt: null, createdAt: new Date().toISOString() };
  await memory.saveWorkflow(wfA, { workspaceId: WS_A });
  await memory.saveWorkflow(wfB, { workspaceId: WS_B });
  await memory.saveWorkflow(wfLegacy);

  const listedForA = await memory.listWorkflows({ workspaceId: WS_A });
  const idsA = listedForA.map((w) => w.id).sort();
  assert.ok(idsA.includes(wfA.id), 'workspace A sees its own workflow');
  assert.ok(idsA.includes(wfLegacy.id), 'workspace A sees legacy (null workspace_id) workflow');
  assert.ok(!idsA.includes(wfB.id), 'workspace A must NOT see workspace B\'s workflow');
  console.log('✓ scheduled_workflows: stamp + scope + legacy-visible');

  // --- workflow_definitions --------------------------------------------------
  const defA = { id: uuid(), name: 'def A', graph: { nodes: [{ id: 't', type: 'trigger' }], edges: [] },
    enabled: true, workspace_id: WS_A, createdAt: new Date().toISOString() };
  const defB = { id: uuid(), name: 'def B', graph: { nodes: [{ id: 't', type: 'trigger' }], edges: [] },
    enabled: true, workspace_id: WS_B, createdAt: new Date().toISOString() };
  const defLegacy = { id: uuid(), name: 'legacy def', graph: { nodes: [{ id: 't', type: 'trigger' }], edges: [] },
    enabled: true, createdAt: new Date().toISOString() };
  await memory.saveWorkflowDefinition(defA, { workspaceId: WS_A });
  await memory.saveWorkflowDefinition(defB, { workspaceId: WS_B });
  await memory.saveWorkflowDefinition(defLegacy);

  const defsForA = await memory.listWorkflowDefinitions({ workspaceId: WS_A });
  const defIdsA = defsForA.map((d) => d.id);
  assert.ok(defIdsA.includes(defA.id), 'workspace A sees its own definition');
  assert.ok(defIdsA.includes(defLegacy.id), 'workspace A sees legacy definition');
  assert.ok(!defIdsA.includes(defB.id), 'workspace A must NOT see workspace B\'s definition');
  console.log('✓ workflow_definitions: stamp + scope + legacy-visible');

  // --- workflow_runs ---------------------------------------------------------
  const runA = { id: uuid(), workflowId: defA.id, status: 'running', workspace_id: WS_A };
  const runB = { id: uuid(), workflowId: defB.id, status: 'running', workspace_id: WS_B };
  await memory.saveWorkflowRun(runA, { workspaceId: WS_A });
  await memory.saveWorkflowRun(runB, { workspaceId: WS_B });
  const fetchedA = await memory.getWorkflowRun(runA.id);
  const fetchedB = await memory.getWorkflowRun(runB.id);
  assert.strictEqual(fetchedA.workspace_id, WS_A, 'workflow_run A persists its workspace_id');
  assert.strictEqual(fetchedB.workspace_id, WS_B, 'workflow_run B persists its workspace_id');
  console.log('✓ workflow_runs: stamp survives round-trip');

  // --- briefing_runs ---------------------------------------------------------
  const brA = await memory.saveBriefingRun({ goal: 'daily brief', output: 'A-content', workspace_id: WS_A });
  const brB = await memory.saveBriefingRun({ goal: 'daily brief', output: 'B-content', workspace_id: WS_B });
  const brLegacy = await memory.saveBriefingRun({ goal: 'daily brief', output: 'legacy-content' });
  assert.strictEqual(brA.workspace_id, WS_A);
  assert.strictEqual(brB.workspace_id, WS_B);
  assert.strictEqual(brLegacy.workspace_id || null, null);

  // A workspace-scoped getLatestBriefingRun must prefer its OWN run (or
  // legacy), never another workspace's.
  const latestForA = await memory.getLatestBriefingRun('daily brief', { workspaceId: WS_A });
  assert.ok(latestForA, 'workspace A finds a run for this goal');
  assert.ok(latestForA.workspace_id === WS_A || latestForA.workspace_id == null,
    `workspace A got the wrong run: ${latestForA.workspace_id} (must be ${WS_A} or null)`);
  console.log('✓ briefing_runs: stamp + scope + legacy fallback');

  // --- briefing_articles -----------------------------------------------------
  await memory.saveBriefingArticles([
    { workflowGoal: 'coverage test', title: 'a', url: 'https://a.example', sourceDomain: 'a.example', summary: 'A' },
  ], { workspaceId: WS_A });
  await memory.saveBriefingArticles([
    { workflowGoal: 'coverage test', title: 'b', url: 'https://b.example', sourceDomain: 'b.example', summary: 'B' },
  ], { workspaceId: WS_B });
  await memory.saveBriefingArticles([
    { workflowGoal: 'coverage test', title: 'legacy', url: 'https://legacy.example', sourceDomain: 'legacy.example', summary: 'L' },
  ]);

  const articlesForA = await memory.getBriefingArticles('coverage test', { workspaceId: WS_A });
  const urls = articlesForA.map((a) => a.url);
  assert.ok(urls.includes('https://a.example'), 'workspace A sees its own article');
  assert.ok(urls.includes('https://legacy.example'), 'workspace A sees legacy article');
  assert.ok(!urls.includes('https://b.example'), 'workspace A must NOT see workspace B\'s article');
  console.log('✓ briefing_articles: stamp + scope + legacy-visible');

  // --- skills ----------------------------------------------------------------
  await memory.saveSkill({ id: 'skill-a', name: 'Skill A', version: '1.0.0', workspace_id: WS_A, installedAt: new Date().toISOString() });
  await memory.saveSkill({ id: 'skill-b', name: 'Skill B', version: '1.0.0', workspace_id: WS_B, installedAt: new Date().toISOString() });
  await memory.saveSkill({ id: 'skill-legacy', name: 'Legacy Skill', version: '1.0.0', installedAt: new Date().toISOString() });
  const skillsForA = await memory.listSkills({ workspaceId: WS_A });
  const skillIds = skillsForA.map((s) => s.id);
  assert.ok(skillIds.includes('skill-a'), 'workspace A sees its own skill');
  assert.ok(skillIds.includes('skill-legacy'), 'workspace A sees legacy skill');
  assert.ok(!skillIds.includes('skill-b'), 'workspace A must NOT see workspace B\'s skill');
  console.log('✓ skills: stamp + scope + legacy-visible');

  // --- long_term_memory -----------------------------------------------------
  await memory.addFact('remember A fact', { workspaceId: WS_A });
  await memory.addFact('remember B fact', { workspaceId: WS_B });
  await memory.addFact('remember legacy fact');
  const factsForA = await memory.getFacts(50, { workspaceId: WS_A });
  const factContents = factsForA.map((f) => f.fact);
  assert.ok(factContents.includes('remember A fact'), 'workspace A sees its own fact');
  assert.ok(factContents.includes('remember legacy fact'), 'workspace A sees legacy fact');
  assert.ok(!factContents.includes('remember B fact'), 'workspace A must NOT see workspace B\'s fact');
  console.log('✓ long_term_memory: stamp + scope + legacy-visible');

  console.log('\nAll Phase 2.3c workspace stamping + scoping checks passed.');
}

main().catch((err) => {
  console.error('✗ workspace-tables-phase2c.test.js failed:', err);
  process.exit(1);
});
