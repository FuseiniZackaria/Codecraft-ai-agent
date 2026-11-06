// Customer photos (E) and product photos (F), through the real WhatsApp path:
// a photo is downloaded from WAHA, looked at, matched to the catalogue and
// answered; product photos follow the reply (link + preview if a photo can't
// be sent); receipt screenshots are never confirmed; anything unreadable
// alerts the owner. WAHA, the AI and the alerts are stubbed - nothing is sent.

process.env.CC_TESTING = '1';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_FORCE_MOCK_PROVIDER = '1';
process.env.WHATSAPP_PROVIDER = 'waha';
process.env.WAHA_WEBHOOK_SECRET = 'test-webhook-secret';
delete process.env.WA_AUTO_REPLY;

const assert = require('assert');
const http = require('http');
const config = require('../config');
const mockProvider = require('../core/providers/mockProvider');
const orchestrator = require('../core/orchestrator');
const notifications = require('../core/notifications');
const memory = require('../memory');
const catalogStore = require('../core/catalog/store');
const waha = require('../core/whatsapp/WahaProvider');
const messaging = require('../core/whatsapp/messaging');
const WhatsAppAgent = require('../agents/whatsapp/WhatsAppAgent');

const WS = 'aaaaaaaa-0000-0000-0000-0000000000e9';

// ---- the AI: photo descriptions (calls with an image) and replies ----
let vision = null; // what the photo "shows"; an Error = AI down
let visionCalls = [];
let reply = null;
let lastDraftPrompt = null;
mockProvider.complete = async (req) => {
  if (req.content) {
    visionCalls.push(req);
    if (vision instanceof Error) throw vision;
    return { provider: 'mock', text: JSON.stringify(vision) };
  }
  lastDraftPrompt = req;
  return { provider: 'mock', text: JSON.stringify(reply) };
};

// ---- everything that would leave the building ----
const sends = []; // payloads of approved WhatsApp sends
let photoFails = false;
orchestrator.approveTask = async (taskId) => {
  const t = await memory.getTask(taskId);
  sends.push(t.payload);
  if (t.payload.image && photoFails) return { ...t, status: 'failed' };
  return { ...t, status: 'done' };
};
const attention = [];
const pending = [];
notifications.notifyOwnerAttention = async (a) => { attention.push(a); return { whatsapp: 'sent' }; };
notifications.notifyOwnerPendingApproval = async (a) => { pending.push(a); return {}; };
notifications.notifyOwnerFyi = async () => 'sent';
let downloadFails = false;
const realDownload = waha.downloadMedia;
waha.downloadMedia = async () => { if (downloadFails) throw new Error('WAHA said 404'); return { data: 'AAAA', mimetype: 'image/jpeg', bytes: 3 }; };
waha.sendMessage = async () => ({ id: 'x' });
waha.sendTyping = async () => {};
messaging.timing.sleep = async () => {};
memory.getBusinessProfile = async () => ({ business_name: 'Ama Fashion' });

function reset() { sends.length = 0; attention.length = 0; pending.length = 0; visionCalls = []; photoFails = false; downloadFails = false; }
let n = 0;
const incoming = (extra = {}) => messaging.handleIncomingMessage({
  providerName: 'waha', sessionName: 'default', userId: 'admin-1', workspaceId: WS,
  message: {
    waMessageId: `img-${++n}`, contactNumber: `2332000${String(n).padStart(5, '0')}`, contactName: 'Kofi',
    text: '[image]', mediaType: 'image', mediaUrl: 'http://localhost:3000/api/files/default/abc.jpeg', mediaMime: 'image/jpeg',
    timestamp: new Date().toISOString(), ...extra,
  },
});

(async () => {
  await catalogStore.createProduct(WS, {
    name: 'Slim Black Trouser', category: 'Trousers', stock_status: 'in_stock', stock_qty: 4,
    image_url: 'https://cdn.example.com/trouser.jpg', product_url: 'https://shop.example.com/trouser', source: 'manual',
  });
  await catalogStore.createProduct(WS, { name: 'Pink Shirt', stock_status: 'in_stock', product_url: 'https://shop.example.com/pink-shirt' });

  // E1. A photo of a product: looked at, matched, answered - then the product photo follows.
  {
    reset();
    vision = { kind: 'product', description: 'a pair of slim black trousers', text: '', search_terms: ['trouser', 'black', 'slim'] };
    reply = { reply: 'Yes, we have the Slim Black Trouser in stock.', hold: false, reason: '', sources: ['P1'], photos: ['P1'] };
    const r = await incoming();
    assert.strictEqual(r.routed, true, JSON.stringify(r));
    assert.strictEqual(visionCalls.length, 1, 'the photo is looked at once');
    assert.deepStrictEqual(visionCalls[0].content[0], { inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } }, 'the downloaded photo is what the AI sees');
    assert(lastDraftPrompt.prompt.includes('[The customer sent a photo. It shows: a pair of slim black trousers.'), lastDraftPrompt.prompt);
    assert(lastDraftPrompt.system.includes('[P1] Slim Black Trouser'), 'the matching product is in the knowledge');
    assert(lastDraftPrompt.system.includes('in stock (4 left)'));
    assert.strictEqual(sends.length, 2, JSON.stringify(sends));
    assert.strictEqual(sends[0].body, 'Yes, we have the Slim Black Trouser in stock.', 'the reply goes first');
    assert.deepStrictEqual(sends[1].image, { url: 'https://cdn.example.com/trouser.jpg' }, 'then the product photo');
    assert.strictEqual(sends[1].body, 'Slim Black Trouser', 'caption = product name only (no price)');
    assert.deepStrictEqual(r.reply.photos, [{ product: 'Slim Black Trouser', how: 'photo' }]);
    assert.strictEqual(attention.length, 0, 'no "please attend" alert - Ian handled it');
    console.log('✓ E: a customer photo is looked at, matched to the catalogue and answered; F: the product photo follows the reply');
  }

  // F2. A photo that can't be sent -> the product link with a preview. No photo at all -> the link.
  {
    reset();
    photoFails = true;
    vision = { kind: 'product', description: 'black trousers', search_terms: ['trouser'] };
    reply = { reply: 'Here they are!', hold: false, reason: '', photos: ['P1', 'P2'] };
    const r = await incoming();
    const links = sends.filter((s) => s.linkPreview);
    assert.deepStrictEqual(links.map((s) => s.body), ['Slim Black Trouser: https://shop.example.com/trouser', 'Pink Shirt: https://shop.example.com/pink-shirt']);
    assert.deepStrictEqual(r.reply.photos.map((x) => x.how), ['link', 'link']);
    console.log('✓ F: if a photo can\'t be sent (or there is none), the product link is sent with a preview instead');
  }

  // E3. A receipt / MoMo screenshot is never confirmed.
  {
    reset();
    vision = { kind: 'payment', description: 'a mobile money transfer confirmation', text: 'You have sent GHS 250.00. Transaction ID 7781', search_terms: [] };
    reply = { reply: 'Thanks, payment received!', hold: false, reason: '', photos: ['P1'] };
    const r = await incoming();
    assert.strictEqual(r.reply.held, true);
    assert.deepStrictEqual(sends.map((s) => s.body), [WhatsAppAgent.PAYMENT_HOLD_TEXT], 'only "a team member will confirm" - no photos, no "received"');
    assert.strictEqual(pending.length, 1, 'the owner is asked to check');
    console.log('✓ E: a payment screenshot is never confirmed - "a team member will check and confirm"');
  }

  // E4. Caption + photo: both are used.
  {
    reset();
    vision = { kind: 'product', description: 'a pink shirt', search_terms: ['shirt', 'pink'] };
    reply = { reply: 'We have the Pink Shirt.', hold: false, reason: '', photos: [] };
    await incoming({ text: 'do you have this in size L?' });
    assert(lastDraftPrompt.prompt.includes('do you have this in size L?\n[The customer sent a photo. It shows: a pink shirt.'), lastDraftPrompt.prompt);
    console.log('✓ E: a caption and the photo are read together');
  }

  // E5. Can't download / can't read the photo -> the owner is alerted (as before), nothing is sent.
  {
    reset();
    downloadFails = true;
    await incoming();
    assert.strictEqual(attention.length, 1);
    assert.strictEqual(attention[0].mediaType, 'image');
    assert.strictEqual(sends.length, 0);
    reset();
    vision = new Error('AI provider error: overloaded');
    const r = await incoming({ contactNumber: '233200099999' });
    assert.strictEqual(r.routed, false, 'handed to the owner instead');
    assert.strictEqual(attention.length, 1, "the AI couldn't look at it -> owner alerted");
    assert.strictEqual(sends.length, 0);
    console.log('✓ E: if a photo can\'t be downloaded or read, you are alerted and nothing is sent');
  }

  // E6. Stickers / voice notes are unchanged: no reply, owner alerted.
  {
    reset();
    const r = await incoming({ text: '[sticker]', mediaType: 'sticker', mediaUrl: 'http://localhost:3000/api/files/default/s.webp', contactNumber: '233200088888' });
    assert.strictEqual(r.routed, false);
    assert.strictEqual(attention.length, 1);
    assert.strictEqual(visionCalls.length, 0);
    console.log('✓ stickers and voice notes still get no reply - you are alerted');
  }

  // F7. Held replies send no photos.
  {
    reset();
    vision = { kind: 'product', description: 'black trousers', search_terms: ['trouser'] };
    reply = { reply: 'They are GHS 250.', hold: false, reason: '', photos: ['P1'] };
    const r = await incoming();
    assert.strictEqual(r.reply.held, true, 'a price waits for approval (your option A)');
    assert(!sends.some((s) => s.image), 'no photo goes out while the reply waits');
    console.log('✓ F: while a reply waits for your approval, no product photos are sent');
  }

  // WAHA: download uses WAHA's real address + key (its links say localhost); sendImage body.
  {
    const seen = [];
    const fake = http.createServer((req, res) => {
      seen.push({ url: req.url, key: req.headers['x-api-key'], method: req.method, body: '' });
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        seen[seen.length - 1].body = body;
        if (req.url.startsWith('/api/files/')) { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(Buffer.from([0xff, 0xd8, 0xff, 0x00])); }
        res.writeHead(201, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'sent-1' }));
      });
    });
    await new Promise((r) => fake.listen(0, '127.0.0.1', r));
    const prev = { ...config.waha };
    config.waha.baseUrl = `http://127.0.0.1:${fake.address().port}`;
    config.waha.apiKey = 'test-key';
    const got = await realDownload('http://localhost:3000/api/files/default/abc.jpeg', 'image/jpeg');
    assert.strictEqual(got.bytes, 4);
    assert.strictEqual(seen[0].url, '/api/files/default/abc.jpeg', 'localhost replaced by the real WAHA address');
    assert.strictEqual(seen[0].key, 'test-key');
    await assert.rejects(realDownload('https://evil.example.com/steal'), /Not a WAHA file link/);
    const sendGuard = require('../core/sendGuard');
    const realAssert = sendGuard.assertRealSendsAllowed;
    sendGuard.assertRealSendsAllowed = () => {};
    await waha.sendImage('default', '233200000001', { url: 'https://cdn.example.com/a.png?x=1' }, 'A thing');
    sendGuard.assertRealSendsAllowed = realAssert;
    const sent = JSON.parse(seen[1].body);
    assert.strictEqual(seen[1].url, '/api/sendImage');
    assert.deepStrictEqual(sent.file, { mimetype: 'image/png', filename: 'photo.png', url: 'https://cdn.example.com/a.png?x=1' });
    assert.strictEqual(sent.caption, 'A thing');
    Object.assign(config.waha, prev);
    fake.close();
    console.log('✓ WAHA: photos are downloaded from WAHA\'s real address with the key; sendImage gets the right file type');
  }

  console.log('All WhatsApp image checks passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
