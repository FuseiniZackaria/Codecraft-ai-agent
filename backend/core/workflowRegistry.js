const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.join(__dirname, 'workflow-registry', 'index.json');

/**
 * WorkflowRegistry - a local index of shareable workflow graphs, same
 * honest approach as core/installer/Registry.js for skills: there's no
 * hosted registry.codecraft.ai yet, so this reads a JSON file shipped with
 * the app (with real, tested sample workflows) instead of pretending to
 * hit a network service. Simpler than the skill registry since a workflow
 * "package" is just a graph + metadata - no code to download/verify/activate.
 */
class WorkflowRegistry {
  _loadIndex() {
    return JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
  }

  search(query = '') {
    const index = this._loadIndex();
    const q = query.toLowerCase();
    const matches = !q
      ? index
      : index.filter(
          (w) => w.name.toLowerCase().includes(q) || w.description.toLowerCase().includes(q) || w.category.toLowerCase().includes(q)
        );
    return matches.map(stripGraph);
  }

  getDetails(id) {
    const entry = this._loadIndex().find((w) => w.id === id);
    if (!entry) throw new Error(`Workflow "${id}" not found in registry`);
    return entry;
  }

  listCategories() {
    return [...new Set(this._loadIndex().map((w) => w.category))];
  }
}

function stripGraph(entry) {
  const { graph, ...meta } = entry;
  return meta;
}

module.exports = { WorkflowRegistry };
