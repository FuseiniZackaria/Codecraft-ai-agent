// Run once: node delete-persona-job-workflow.js
// Deletes the "persona job" scheduled workflow that fires the job search autonomously.
require('dotenv').config();
const memory = require('./memory');

(async () => {
  const workflows = await memory.listWorkflows();
  console.log('All workflows in database:');
  workflows.forEach((w) => console.log(`  [${w.enabled ? 'ENABLED' : 'disabled'}] "${w.name}" (${w.id}) - ${w.scheduleType} - goal: ${w.goal.slice(0, 60)}`));

  const target = workflows.find((w) => w.name === 'persona job' || w.goal.includes('find me jobs and apply'));
  if (!target) {
    console.log('\nNo matching workflow found - nothing to delete.');
    process.exit(0);
  }
  console.log(`\nDeleting: "${target.name}" (${target.id})`);
  await memory.deleteWorkflow(target.id);
  console.log('Deleted.');
  process.exit(0);
})().catch((err) => { console.error(err.message); process.exit(1); });
