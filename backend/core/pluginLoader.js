const fs = require('fs');
const path = require('path');
const toolRegistry = require('../tools/ToolRegistry');
const activityLog = require('./activityLog');

const PLUGINS_DIR = path.join(__dirname, '..', 'plugins');

/**
 * Auto-discovers plugins by scanning each plugin folder for a manifest.json,
 * then loads each declared action from plugins/<name>/actions/<action>.js
 * and registers it into the global ToolRegistry as "<pluginName>.<actionName>".
 */
function loadPlugins() {
  const loaded = [];

  if (!fs.existsSync(PLUGINS_DIR)) return loaded;

  const pluginDirs = fs.readdirSync(PLUGINS_DIR).filter((f) =>
    fs.statSync(path.join(PLUGINS_DIR, f)).isDirectory()
  );

  for (const dir of pluginDirs) {
    const manifestPath = path.join(PLUGINS_DIR, dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    for (const actionName of manifest.actions || []) {
      const actionPath = path.join(PLUGINS_DIR, dir, 'actions', `${actionName}.js`);
      if (!fs.existsSync(actionPath)) {
        console.warn(`[pluginLoader] ${manifest.name}: missing action file for "${actionName}"`);
        continue;
      }
      const action = require(actionPath);
      toolRegistry.register(`${manifest.name}.${actionName}`, {
        permission: action.permission,
        irreversible: !!action.irreversible,
        run: action.run,
      });
    }

    // Fire-and-forget: don't let a slow/unreachable memory backend block startup.
    activityLog.record('system', 'plugin_loaded', manifest.name, { version: manifest.version }).catch((err) => {
      console.warn(`[pluginLoader] failed to write audit log for ${manifest.name}: ${err.message}`);
    });
    loaded.push(manifest.name);
  }

  return loaded;
}

module.exports = { loadPlugins };
