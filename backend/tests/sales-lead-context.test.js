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

const { buildLeadQueries, targetRoles } = require('../agents/sales/SalesAgent')._internals;
const REQUEST2 =
  "Find me 10 individuals in Accra, Ghana who need AI in Marketing. What I'm selling: an AI in Marketing Course. " +
  'Target customer: individuals (e.g. active marketers, marketing professionals, freelancers, social media managers, ' +
  'marketing lecturers and students, small business owners who do their own marketing). ' +
  'Search platforms: Google Maps, Instagram, Facebook, TikTok, X (Twitter), LinkedIn.';
const ctx2 = parseLeadContext(REQUEST2);
assert.strictEqual(ctx2.offer, 'an AI in Marketing Course');
const roles2 = targetRoles(ctx2.target);
assert.deepStrictEqual(roles2.slice(0, 6), ['active marketers', 'marketing professionals', 'marketing freelancers', 'social media managers', 'marketing lecturers', 'marketing students']);
const platforms2 = ['google_maps', 'instagram', 'facebook', 'tiktok', 'x', 'linkedin'];
const q2 = buildLeadQueries(ctx2, platforms2);
assert.ok(!q2.some((q) => q.includes('google.com/maps')), 'no Google Maps search for individuals');
assert.ok(q2.some((q) => q.includes('site:linkedin.com/in')), 'LinkedIn person profiles');
assert.ok(q2.every((q) => q.length < 120), `queries stay short: ${q2.find((q) => q.length >= 120)}`);
assert.ok(q2.every((q) => !q.includes('(e.g.')), 'the example list is not pasted into queries');
const qBiz = buildLeadQueries(parseLeadContext('Find 10 restaurants in Accra, Ghana'), platforms2);
assert.ok(qBiz.some((q) => q.includes('google.com/maps')), 'businesses still search Google Maps');
console.log('✓ individuals: short role searches, LinkedIn profiles, no Google Maps');
