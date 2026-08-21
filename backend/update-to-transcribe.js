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
  console.log("Status:", res.status);
  console.log("Workflow now transcribes instead of the old placeholder.");
})();
