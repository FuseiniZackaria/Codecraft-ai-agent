const os = require("os");
const path = require("path");
const downloadsPath = path.join(os.homedir(), "Downloads");

(async () => {
  const res = await fetch("http://localhost:4000/api/workflow-definitions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Downloads watcher test 2",
      graph: {
        nodes: [
          { id: "trigger_1", type: "trigger", config: {} },
          { id: "node_1", type: "agent", config: { agentKey: "ceo", goal: "test" } },
        ],
        edges: [{ id: "e1", source: "trigger_1", target: "node_1" }],
      },
      scheduleType: "folder_watch",
      watchFolder: downloadsPath,
    }),
  });
  const body = await res.json();
  console.log("Status:", res.status);
  console.log("Full response body:", JSON.stringify(body, null, 2));
})();
