const graph = {
  nodes: [
    { id: "trigger_1", type: "trigger", config: {} },
    { id: "decide_1", type: "decide", config: {
      question: "Given recent activity, is there something worth proactively researching right now?",
      options: [
        { id: "competitors", label: "Research what competitors are doing this week" },
        { id: "trends", label: "Check YouTube trends for content ideas" },
      ],
    }},
    { id: "competitor_research", type: "agent", config: { agentKey: "research", goal: "Research what our competitors did this week" } },
    { id: "trend_research", type: "tool", config: { tool: "youtube.getTrending", args: { maxResults: 5 } } },
  ],
  edges: [
    { id: "e1", source: "trigger_1", target: "decide_1" },
    { id: "e2", source: "decide_1", target: "competitor_research", branch: "competitors" },
    { id: "e3", source: "decide_1", target: "trend_research", branch: "trends" },
  ],
};

(async () => {
  const res = await fetch("http://localhost:4000/api/workflow-definitions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Daily self-prompt test", graph, scheduleType: "interval", intervalMinutes: 60 }),
  });
  const def = await res.json();
  console.log("Created:", def.id);
  const runRes = await fetch(`http://localhost:4000/api/workflow-definitions/${def.id}/run`, { method: "POST" });
  const run = await runRes.json();
  console.log("It decided on its own:", run.context?.decide_1?.output);
  console.log("Status:", run.status);
})();
