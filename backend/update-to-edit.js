const path = require("path");

// Both steps share the same projectId, so the transcript always lands at
// this predictable location - referencing it directly, since workflow
// templates can only pull a whole tool's ".output" (a JSON blob here), not
// a specific field like ".srtPath" out of it.
const srtPath = path.join(process.cwd(), "workspace", "video-pipeline", "transcript.srt");

const graph = {
  nodes: [
    { id: "trigger_1", type: "trigger", config: {} },
    { id: "transcribe_1", type: "tool", config: { tool: "speech.transcribe", args: { filePath: "{{trigger.output}}", projectId: "video-pipeline" } } },
    { id: "edit_1", type: "tool", config: { tool: "video.edit", args: { inputPath: "{{trigger.output}}", projectId: "video-pipeline", srtPath } } },
  ],
  edges: [
    { id: "e1", source: "trigger_1", target: "transcribe_1" },
    { id: "e2", source: "transcribe_1", target: "edit_1" },
  ],
};

(async () => {
  const res = await fetch("http://localhost:4000/api/workflow-definitions/b9877d18-76dd-4da7-8db3-285dd07e13cd", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graph }),
  });
  const verify = await (await fetch("http://localhost:4000/api/workflow-definitions/b9877d18-76dd-4da7-8db3-285dd07e13cd")).json();
  console.log("Status:", res.status, "| Nodes now:", verify.graph.nodes.map(n => n.id));
  console.log("srtPath baked into edit_1:", verify.graph.nodes.find(n => n.id === "edit_1").config.args.srtPath);
})();
