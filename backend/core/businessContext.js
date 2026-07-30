const config = require('../config');

function businessContextLine() {
  const b = config.business || {};
  const parts = [];
  if (b.companyName) parts.push(`Company: ${b.companyName}`);
  if (b.industry) parts.push(`Industry: ${b.industry}`);
  if (b.targetMarket) parts.push(`Target market: ${b.targetMarket}`);
  if (b.description) parts.push(`Description: ${b.description}`);
  if (b.knownCompetitors?.length) parts.push(`Known competitors: ${b.knownCompetitors.join(', ')}`);
  return parts.length ? `Business context:\n${parts.join('\n')}\n\n` : '';
}

module.exports = { businessContextLine };
