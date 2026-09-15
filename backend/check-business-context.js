/**
 * check-business-context.js - one-off diagnostic script.
 *
 * Shows EXACTLY what business info is currently loaded and what text block
 * gets injected into every drafted reply (Telegram, WhatsApp, chat, etc.) -
 * so you can directly confirm what you've fed it is actually being used,
 * instead of trusting it blindly.
 *
 * Run from the backend/ folder:
 *   node check-business-context.js
 */

const config = require('./config');
const { businessContextLine, hasBusinessKnowledge } = require('./core/businessContext');

console.log('=== Raw business.json content ===\n');
console.log(JSON.stringify(config.business, null, 2));

console.log('\n=== hasBusinessKnowledge() ===\n');
const has = hasBusinessKnowledge();
console.log(has);
if (!has) {
  console.log('\n⚠️  This is FALSE - meaning auto-reply will refuse to send anything at all,');
  console.log('    since there is nothing for it to confidently ground an answer in.');
  console.log('    Fill in at least one of: description, hours, location, website,');
  console.log('    services, pricing, policies, or a real FAQ entry.');
}

console.log('\n=== Exact text block injected into every draft/classification prompt ===\n');
const line = businessContextLine();
if (!line) {
  console.log('(empty - nothing gets injected right now, same reason as above)');
} else {
  console.log(line);
}

console.log('=== What this tells you ===\n');
console.log('If a field you fed through the Chat page does NOT appear in the raw JSON');
console.log('above, it was never actually saved - re-check the confirmation message you');
console.log('got back in chat when you sent it.');
console.log('');
console.log('If a field DOES appear in the raw JSON but is missing from the text block');
console.log('above, that is a real bug worth reporting - the rendering logic in');
console.log('core/businessContext.js is not including it.');
console.log('');
console.log('If everything looks correct here but the bot still answers wrong, the issue');
console.log('is happening at the AI drafting step itself, not in how the business info is');
console.log('stored or fed in - worth pasting the exact wrong reply for a closer look.');