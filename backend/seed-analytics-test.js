const crypto = require("crypto");
const memory = require("./memory");
const activityLog = require("./core/activityLog");

(async () => {
  console.log("--- Writing test data directly to your real database (no API calls, zero cost) ---");
  const now = Date.now();
  const iso = (msAgo) => new Date(now - msAgo).toISOString();

  const taskId1 = crypto.randomUUID();
  const taskId2 = crypto.randomUUID();

  await memory.saveTask({ id: taskId1, agent: "research", instruction: "test task 1", status: "pending", created_at: iso(60000) });
  await memory.updateTask(taskId1, { status: "done" });
  await memory.saveTask({ id: taskId2, agent: "ceo", instruction: "test task 2", status: "pending", created_at: iso(30000) });
  await memory.updateTask(taskId2, { status: "failed" });

  await activityLog.record("research", "llm_call", "ai", { taskId: taskId1, cost: 0.0234, inputTokens: 8000, outputTokens: 1200, status: "done" });
  await activityLog.record("ceo", "llm_call", "ai", { taskId: taskId2, cost: 0.0089, inputTokens: 3000, outputTokens: 400, status: "done" });

  console.log("Done. Expected on the Analytics page (30-day range):");
  console.log("  Total cost: $0.03 (0.0234 + 0.0089)");
  console.log("  LLM calls: 2");
  console.log("  Task success rate: 50% (1 done, 1 failed)");
  console.log("  Cost by agent: research ~$0.02, ceo ~$0.01");
})();
