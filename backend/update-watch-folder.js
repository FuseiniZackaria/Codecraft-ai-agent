const os = require("os");
const path = require("path");
const fs = require("fs");

const newFolder = path.join(os.homedir(), "Downloads", "ContentDrops");

(async () => {
  if (!fs.existsSync(newFolder)) {
    fs.mkdirSync(newFolder, { recursive: true });
    console.log("Created folder:", newFolder);
  } else {
    console.log("Folder already exists:", newFolder);
  }

  const res = await fetch("http://localhost:4000/api/workflow-definitions/b9877d18-76dd-4da7-8db3-285dd07e13cd", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ watchFolder: newFolder }),
  });
  const body = await res.json();
  console.log("Status:", res.status);
  console.log("watchFolder is now:", body.watchFolder);
})();
