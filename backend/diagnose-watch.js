const os = require("os");
const path = require("path");
const fs = require("fs");

const folder = path.join(os.homedir(), "Downloads", "ContentDrops");

(async () => {
  console.log("=== 1. The actual stored workflow definition ===");
  const res = await fetch("http://localhost:4000/api/workflow-definitions/b9877d18-76dd-4da7-8db3-285dd07e13cd");
  const def = await res.json();
  console.log("enabled:", def.enabled);
  console.log("scheduleType:", def.scheduleType);
  console.log("watchFolder:", def.watchFolder);
  console.log("lastRunAt:", def.lastRunAt);
  console.log("createdAt:", def.createdAt);

  console.log();
  console.log("=== 2. What is actually sitting in the folder right now ===");
  if (!fs.existsSync(folder)) {
    console.log("FOLDER DOES NOT EXIST:", folder);
  } else {
    const files = fs.readdirSync(folder);
    if (files.length === 0) {
      console.log("Folder exists but is EMPTY:", folder);
    }
    for (const name of files) {
      const fullPath = path.join(folder, name);
      const stat = fs.statSync(fullPath);
      console.log("-", name);
      console.log("    extension:", path.extname(name).toLowerCase());
      console.log("    isDirectory:", stat.isDirectory());
      console.log("    modified:", stat.mtime.toISOString());
    }
  }

  console.log();
  console.log("=== 3. Would this file be picked up? ===");
  const VIDEO_EXTENSIONS = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"];
  const sinceMs = def.lastRunAt ? new Date(def.lastRunAt).getTime() : new Date(def.createdAt).getTime();
  console.log("Files are only picked up if modified after:", new Date(sinceMs).toISOString());
})();
