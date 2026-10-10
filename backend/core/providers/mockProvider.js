/**
 * MockProvider
 *
 * Stand-in LLM adapter used when no real provider key is configured, so the
 * orchestrator/agent pipeline is runnable and testable out of the box.
 * Real adapters (openaiProvider.js, aiProvider.js, ...) implement the
 * same `complete({ prompt, system }) -> { text, provider, costEstimate }` interface.
 *
 * The `complete` method is defined as an accessor pair so that when a test
 * assigns `mockProvider.complete = fn` to stub a response, we ALSO flip
 * CC_FORCE_MOCK_PROVIDER=1 on the environment. Without that flag, router.js
 * would pick aiProvider (whenever AI_API_KEY is set in .env) and the stub
 * would never run. The flag only lasts the lifetime of this Node process -
 * each test file runs in its own process via scripts/run-tests.js, so it
 * never leaks across tests. Call `mockProvider.restore()` to go back to
 * the shipped default; the test runner isolates processes so restoring is
 * optional, but it keeps intra-file test code easy to reason about.
 */
const defaultComplete = async ({ prompt, content }) => {
  const preview = prompt ? prompt.slice(0, 120) : '[attachment(s) - mock provider cannot see file content]';
  return {
    provider: 'mock',
    text: `[mock response] Task understood: "${preview}". ` +
          `(Configure OPENAI_API_KEY or AI_API_KEY to use a real model.)`,
    costEstimate: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
};

let impl = defaultComplete;

module.exports = {
  name: 'mock',
  costPerCall: 0,
  speed: 'instant',
  get complete() { return impl; },
  set complete(fn) {
    impl = fn;
    // Tests that stub this method want it to actually run; router.js honors
    // this env flag by returning mockProvider ahead of any real adapter.
    process.env.CC_FORCE_MOCK_PROVIDER = '1';
  },
  restore() {
    impl = defaultComplete;
    delete process.env.CC_FORCE_MOCK_PROVIDER;
  },
};
