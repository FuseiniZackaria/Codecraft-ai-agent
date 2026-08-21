const graph = {
  nodes: [
    { id: "trigger_1", type: "trigger", config: {} },
    { id: "node_1", type: "agent", config: { agentKey: "ceo", goal: "What is one quick win we could ship this week?" } },
    { id: "node_2", type: "approval", config: { label: "Review this recommendation" } },
  ],
  edges: [
    { id: "e1", source: "trigger_1", target: "node_1" },
    { id: "e2", source: "node_1", target: "node_2" },
  ],
};

(async () => {
  const createRes = await fetch("http://localhost:4000/api/workflow-definitions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Approval test", graph }),
  });
  const definition = await createRes.json();

  const runRes = await fetch(`http://localhost:4000/api/workflow-definitions/${definition.id}/run`, { method: "POST" });
  const run = await runRes.json();
  console.log("Run status:", run.status, "(should be paused_for_approval)");
  console.log("Now go check the Tasks page in the app.");
})();
