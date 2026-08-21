(async () => {
  const res = await fetch("http://localhost:4000/api/workflow-definitions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "YouTube key test",
      graph: {
        nodes: [
          { id: "trigger_1", type: "trigger", config: {} },
          { id: "node_1", type: "tool", config: { tool: "youtube.search", args: { query: "how to bake sourdough bread", maxResults: 3 } } },
        ],
        edges: [{ id: "e1", source: "trigger_1", target: "node_1" }],
      },
    }),
  });
  const definition = await res.json();
  console.log("Created:", definition.id, "| status:", res.status);

  const runRes = await fetch(`http://localhost:4000/api/workflow-definitions/${definition.id}/run`, { method: "POST" });
  const run = await runRes.json();
  console.log("Run status:", run.status);
  console.log(JSON.stringify(run.context?.node_1?.output, null, 2));
})();
