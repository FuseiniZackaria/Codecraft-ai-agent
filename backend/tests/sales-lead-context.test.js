// Lead-gen must search for the target customers, not the word "leads", and
// must only attach an email / phone found in a result about that lead.

process.env.CC_TESTING = '1';
process.env.CC_FORCE_MEMORY_STORE = '1';

const assert = require('assert');
const { parseLeadContext, findContact, extractPhone } = require('../agents/sales/SalesAgent')._internals;

const REQUEST =
  'Find 10 leads in Accra, Ghana: businesses or social media handles that need AI in Marketing. ' +
  "I'm selling AI in Marketing (training/solutions). Target customers are marketing students and " +
  'marketing professionals. Search across Google Maps, Instagram, Facebook, TikTok, X (Twitter), and LinkedIn.';

const ctx = parseLeadContext(REQUEST);
assert.strictEqual(ctx.target, 'marketing students and marketing professionals');
assert.strictEqual(ctx.location, 'Accra, Ghana');
assert.strictEqual(ctx.count, 10);
assert.ok(/AI in Marketing/.test(ctx.offer), `offer parsed: ${ctx.offer}`);
assert.strictEqual(ctx.need, 'AI in Marketing');
console.log('✓ target, offer and need come from the request, not the word "leads"');

const noTarget = parseLeadContext('Find 5 leads in Kumasi that need bookkeeping');
assert.strictEqual(noTarget.target, 'businesses that need bookkeeping');
assert.strictEqual(parseLeadContext('Find 10 restaurants in Accra').target, 'restaurants');
console.log('✓ generic "leads" falls back to the need; a real target is kept');

assert.strictEqual(extractPhone('USP-Brazil Barueri-SP 06454-000, Brazil'), null);
assert.strictEqual(extractPhone('Call +233 24 172 1010 today'), '+233 24 172 1010');
assert.strictEqual(extractPhone('Phone: 0243-482102'), '0243-482102');
console.log('✓ postcodes are not phone numbers');

const results = [
  { url: 'https://hotel.example', title: 'Accra City Hotel', content: 'Book now info@accracityhotel.com 0243-482-102' },
  { url: 'https://citylead.com/accra', title: 'CityLead Accra', content: 'CityLead Accra - write to accra@citylead.com' },
];
const found = findContact('CityLead Accra', results);
assert.strictEqual(found.email, 'accra@citylead.com');
assert.strictEqual(found.emailSource, 'https://citylead.com/accra');
assert.strictEqual(found.phone, null);
console.log('✓ contact details only come from a result that names the lead');

console.log('\nAll sales-lead-context checks passed.');
