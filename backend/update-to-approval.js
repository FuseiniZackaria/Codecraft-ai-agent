const graph = {
  nodes: [
    { id: "trigger_1", type: "trigger", config: {} },
    { id: "transcribe_1", type: "tool", config: { tool: "speech.transcribe", args: { filePath: "{{trigger.output}}", projectId: "video-pipeline" } } },
    { id: "edit_1", type: "tool", config: { tool: "video.edit", args: { inputPath: "{{trigger.output}}", projectId: "video-pipeline", srtPath: "C:\\Users\\Dell\\codecraft-ai\\backend\\workspace\\video-pipeline\\transcript.srt" } } },
    { id: "approval_1", type: "approval", config: {
      label: "Review the edited video before it can be posted",
      previewType: "video",
      previewUrl: "http://localhost:4000/api/workspace/video-pipeline/file/edited.mp4",
    }},
  ],
  edges: [
    { id: "e1", source: "trigger_1", target: "transcribe_1" },
    { id: "e2", source: "transcribe_1", target: "edit_1" },
    { id: "e3", source: "edit_1", target: "approval_1" },
  ],
};

(async () => {
  const res = await fetch("http://localhost:4000/api/workflow-definitions/b9877d18-76dd-4da7-8db3-285dd07e13cd", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ graph }),
  });
  console.log("Status:", res.status);
})();
