const os = require("os");
const path = require("path");

const downloadsPath = path.join(os.homedir(), "Downloads");
console.log("Your real Downloads folder path:", downloadsPath);

const graph = {
  nodes: [
    { id: "trigger_1", type: "trigger", config: {} },
    { id: "node_1", type: "agent", config: { agentKey: "ceo", goal: "A new video file was dropped: {{trigger.output}}" } },
  ],
  edges: [{ id: "e1", source: "trigger_1", target: "node_1" }],
};

(async () => {
  const res = await fetch("http://localhost:4000/api/workflow-definitions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Downloads watcher test",
      graph,
      scheduleType: "folder_watch",
      watchFolder: downloadsPath,
    }),
  });
  const definition = await res.json();
  console.log("Created:", definition.id, "| status:", res.status);
  console.log("watchFolder stored exactly as:", definition.watchFolder);
  console.log("Matches what we sent:", definition.watchFolder === downloadsPath);
})();
