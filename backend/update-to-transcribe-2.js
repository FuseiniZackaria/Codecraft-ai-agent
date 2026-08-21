const graph = {
  nodes: [
    { id: "trigger_1", type: "trigger", config: {} },
    { id: "transcribe_1", type: "tool", config: { tool: "speech.transcribe", args: { filePath: "{{trigger.output}}" } } },
  ],
  edges: [{ id: "e1", source: "trigger_1", target: "transcribe_1" }],
};

(async () => {
  const res = await fetch("http://localhost:4000/api/workflow-definitions/b9877d18-76dd-4da7-8db3-285dd07e13cd", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graph }),
  });
  const body = await res.json();
  console.log("Status:", res.status);

  // Verify it actually stuck this time - fetch it back fresh, don't trust the PATCH response alone
  const verifyRes = await fetch("http://localhost:4000/api/workflow-definitions/b9877d18-76dd-4da7-8db3-285dd07e13cd");
  const verified = await verifyRes.json();
  console.log("Node IDs now stored:", verified.graph.nodes.map(n => n.id));
  console.log("Update genuinely took effect:", verified.graph.nodes.some(n => n.id === "transcribe_1"));
})();
