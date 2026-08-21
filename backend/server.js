const express = require('express');
const cors = require('cors');
const config = require('./config');
const { loadPlugins } = require('./core/pluginLoader');
const routes = require('./api/routes');
const webhookRoutes = require('./api/webhookRoutes');
const eventsRoutes = require('./api/eventsRoutes');
const skillsRoutes = require('./api/skillsRoutes');
const workspaceRoutes = require('./api/workspaceRoutes');
const workflowsRoutes = require('./api/workflowsRoutes');
const workflowDefinitionsRoutes = require('./api/workflowDefinitionsRoutes');
const analyticsRoutes = require('./api/analyticsRoutes');
const browserRoutes = require('./api/browserRoutes');
const mcpRoutes = require('./api/mcpRoutes');
const scheduler = require('./core/scheduler');

const app = express();
app.use(cors());
app.use(express.json({ limit: '35mb' }));

const loadedPlugins = loadPlugins();
console.log(`[startup] Loaded plugins: ${loadedPlugins.join(', ') || '(none)'}`);

app.use('/api', routes);
app.use('/webhooks', webhookRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/skills', skillsRoutes);
app.use('/api/workspace', workspaceRoutes);
app.use('/api/workflows', workflowsRoutes);
app.use('/api/workflow-definitions', workflowDefinitionsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/browser', browserRoutes);
app.use('/api/mcp', mcpRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', plugins: loadedPlugins }));

app.listen(config.port, () => {
  console.log(`CodeCraft AI backend running on http://localhost:${config.port}`);
  scheduler.start();
});

module.exports = app;
