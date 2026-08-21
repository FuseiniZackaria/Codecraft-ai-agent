(async () => {
  console.log("=== 1. What graph is actually stored right now? ===");
  const defRes = await fetch("http://localhost:4000/api/workflow-definitions/b9877d18-76dd-4da7-8db3-285dd07e13cd");
  const def = await defRes.json();
  console.log("Node IDs in the current graph:", def.graph.nodes.map(n => `${n.id} (${n.type})`));

  console.log();
  console.log("=== 2. What does the actual run contain? ===");
  const runsRes = await fetch("http://localhost:4000/api/workflow-definitions/b9877d18-76dd-4da7-8db3-285dd07e13cd/runs");
  const runs = await runsRes.json();
  const latest = runs[0];
  console.log("Run status:", latest.status);
  console.log("Keys actually present in context:", Object.keys(latest.context || {}));
  console.log();
  console.log("Full context:", JSON.stringify(latest.context, null, 2));
})();
