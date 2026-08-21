(async () => {
  const res = await fetch("http://localhost:4000/api/workflow-definitions/b9877d18-76dd-4da7-8db3-285dd07e13cd/runs");
  const runs = await res.json();
  if (!runs.length) { console.log("No runs yet - did the video get picked up?"); return; }

  const latest = runs[0];
  console.log("Run status:", latest.status);
  if (latest.status === "failed") {
    console.log("Error:", latest.error);
    return;
  }

  const output = JSON.parse(latest.context?.transcribe_1?.output || "{}");
  console.log();
  console.log("=== TRANSCRIPT ===");
  console.log(output.text);
  console.log();
  console.log("=== FIRST FEW SRT CAPTION LINES ===");
  console.log((output.srt || "").split("\n").slice(0, 8).join("\n"));
})();
