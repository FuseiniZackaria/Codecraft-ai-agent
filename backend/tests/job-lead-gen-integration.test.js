const assert = require('assert');

process.env.TAVILY_API_KEY = 'test-tavily-key-jobleadgen';

const { loadPlugins } = require('../core/pluginLoader');
const toolRegistry = require('../tools/ToolRegistry');
const mockProvider = require('../core/providers/mockProvider');
const aiProvider = require('../core/providers/aiProvider');
const memory = require('../memory');
const { classify: classifyKeywords } = require('../core/orchestrator/keywordClassifier');

function stubProvider(responses) {
  let call = 0;
  const respond = async () => {
    const text = Array.isArray(responses) ? responses[Math.min(call, responses.length - 1)] : responses;
    call++;
    return { text, provider: 'mock', costEstimate: 0 };
  };
  const originalMock = mockProvider.complete;
  const originalAi = aiProvider.complete;
  mockProvider.complete = respond;
  aiProvider.complete = respond;
  return () => {
    mockProvider.complete = originalMock;
    aiProvider.complete = originalAi;
  };
}

function stubTool(name, fn) {
  const original = toolRegistry.tools.get(name);
  toolRegistry.register(name, { permission: name, irreversible: false, run: fn });
  return () => { if (original) toolRegistry.register(name, original); };
}

async function main() {
  loadPlugins();

  // --- Classifier routing ---

  const phrasings = [
    'Find job opportunities for a backend engineer role',
    'Find job openings in AI development',
    'Find job postings for a remote designer',
  ];
  for (const phrase of phrasings) {
    const k = classifyKeywords(phrase);
    assert.strictEqual(k.isOutreach, true, `"${phrase}" should route to isOutreach (Sales Agent), got isOutreach=${k.isOutreach}, isResearch=${k.isResearch}`);
    assert.strictEqual(k.isResearch, false, `"${phrase}" must NOT also match isResearch - isOutreach should take priority`);
  }
  console.log('✓ keywordClassifier: common job-opportunity phrasings route to isOutreach (Sales Agent), not isResearch');

  // A generic, non-job research question must still correctly go to research, unaffected by the new keywords.
  const genericResearch = classifyKeywords('Find opportunities for expanding into new markets');
  assert.strictEqual(genericResearch.isResearch, true, 'non-job "find opportunities" phrasing must still route to research as before');
  assert.strictEqual(genericResearch.isOutreach, false);
  console.log('✓ keywordClassifier: non-job "find opportunities" phrasing is unaffected, still routes to research');

  // --- SalesAgent job lead-gen end-to-end ---

  const SalesAgent = require('../agents/sales/SalesAgent');
  const outreachPipeline = require('../core/outreachPipeline');
  const config = require('../config');
  const agent = new SalesAgent();

  const restoreSearch = stubTool('websearch.search', async () => ({
    answer: null,
    results: [{ title: 'Acme Corp Careers', url: 'https://www.acmecorp.com/careers', content: 'Hiring a backend engineer' }],
  }));

  const uniqueEmail = `hiring+leadgen-${Date.now()}@acmecorp.com`;
  const extractedList = JSON.stringify([
    {
      company: 'Acme Corp',
      jobTitle: 'Backend Engineer',
      applicationUrl: 'https://www.acmecorp.com/careers/backend-engineer',
      companyWebsite: 'https://www.acmecorp.com',
      postedDate: new Date().toISOString(),
      contactEmail: uniqueEmail,
      source: 'company careers page',
      sourceUrl: 'https://www.acmecorp.com/careers/backend-engineer',
      context: 'Backend role requiring Node.js experience.',
    },
    {
      company: 'Sketchy Startup',
      jobTitle: 'Mystery Role',
      applicationUrl: null,
      companyWebsite: null,
      postedDate: '2020-01-01T00:00:00Z',
      contactEmail: null,
      source: 'random forum post',
      sourceUrl: 'https://forum.example/thread/1',
      context: 'Vague posting with no real details.',
    },
  ]);

  const restoreProvider = stubProvider([
    '["backend engineer job opening", "hiring backend engineer", "backend engineer position"]',
    extractedList,
    '13',
    '{"subject": "Quick note", "body": "Hi there, reaching out about the role."}',
    '5',
  ]);
  const restoreSend = stubTool('gmail.sendEmail', async () => ({ status: 'sent' }));

  const task = { instruction: 'Find job opportunities for a backend engineer role', payload: {} };
  const steps = await agent.plan(task);
  assert(steps.some((s) => s.type === 'tool_call' && s.tool === 'websearch.search'), 'job lead-gen plan should include real web searches');
  assert(steps[steps.length - 1].type === 'llm_call', 'job lead-gen plan should end with the extraction step');

  const results = [];
  for (const step of steps) {
    results.push(await agent.execute(step, task, results));
  }
  const reflection = await agent.reflect(task, results);

  restoreSearch(); restoreProvider(); restoreSend();

  assert.strictEqual(reflection.leadsFound, 2);
  assert.strictEqual(reflection.verified, 1, `expected 1 verified opportunity, got ${reflection.verified} (reflection: ${JSON.stringify(reflection)})`);
  assert.strictEqual(reflection.rejected, 1, `expected 1 rejected opportunity, got ${reflection.rejected}`);
  console.log('✓ SalesAgent job lead-gen: extracts candidates and routes them through verification, not direct drafting');

  const allTasks = await memory.listTasks();
  const pipelineTask = allTasks.find(
    (t) => t.payload?.pipelineType === 'job_outreach_pipeline' && t.payload.opportunity?.contactEmail === uniqueEmail
  );
  assert(pipelineTask, 'a real outreach pipeline record should exist for the verified job opportunity found via lead-gen');
  assert.notStrictEqual(pipelineTask.payload.stage, 'rejected_verification');
  console.log('✓ SalesAgent job lead-gen: the verified opportunity produced a real, persisted outreach pipeline record');

  const sketchyTask = allTasks.find((t) => t.instruction?.includes('Sketchy Startup') && t.agent === 'Sales Agent');
  assert(!sketchyTask, 'SalesAgent must never directly draft/send outreach for a job lead - that path is only for the old generic (non-job) lead-gen');
  console.log('✓ SalesAgent job lead-gen: never falls back to the old direct-draft-and-send path for job opportunities');

  console.log('\nAll job lead-gen integration checks passed.');
}

main().catch((err) => {
  console.error('✗ job-lead-gen-integration.test.js failed:', err);
  process.exit(1);
});