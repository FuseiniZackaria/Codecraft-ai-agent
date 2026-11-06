// Links customers send: Ian opens them and reads the page (title, description,
// headings, text - a real browser for modern sites), so "can you build
// something like this? <link>" gets a specific answer. Private addresses are
// never opened; a link that can't be opened is said so (no pretending); the
// customer's own link may appear in the reply. No extra AI call.

process.env.CC_TESTING = '1';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_FORCE_MOCK_PROVIDER = '1';
process.env.WHATSAPP_PROVIDER = 'waha';
delete process.env.WA_AUTO_REPLY;

const assert = require('assert');
const http = require('http');
const mockProvider = require('../core/providers/mockProvider');
const orchestrator = require('../core/orchestrator');
const notifications = require('../core/notifications');
const memory = require('../memory');
const linkReader = require('../core/whatsapp/linkReader');
const WhatsAppAgent = require('../agents/whatsapp/WhatsAppAgent');

const WS = 'aaaaaaaa-0000-0000-0000-0000000000f7';
let aiCalls = 0;
let lastPrompt = null;
let modelAnswer = '';
mockProvider.complete = async (req) => { aiCalls += 1; lastPrompt = req; return { provider: 'mock', text: modelAnswer, costEstimate: 0 }; };
const sent = [];
orchestrator.approveTask = async (taskId) => { const t = await memory.getTask(taskId); sent.push(t.payload.body); return { ...t, status: 'done' }; };
notifications.notifyOwnerFyi = async () => 'sent';
notifications.notifyOwnerPendingApproval = async () => ({});
memory.getBusinessProfile = async () => ({ business_name: 'CodeCraft' });

const site = http.createServer((req, res) => {
  const send = (code, type, body) => { res.writeHead(code, { 'content-type': type }); res.end(body); };
  if (req.url === '/shop') {
    return send(200, 'text/html', `<html><head><title>Ama Fashion - Online Store</title>
      <meta name="description" content="Shop dresses and kaba online. Pay with MoMo, delivery in Accra."></head>
      <body><h1>New arrivals</h1><h2>Cart</h2><p>${'Browse our collection of dresses, kaba and slippers. Add to cart and pay with mobile money. '.repeat(6)}</p>
      <script>var tracking = "ignore me";</script></body></html>`);
  }
  if (req.url === '/app') { // a modern site: text only appears once JavaScript runs
    return send(200, 'text/html', '<html><head><title>Booking App</title></head><body><div id="root"></div>'
      + '<script>document.getElementById("root").innerHTML = "<h1>Book a haircut</h1><p>Choose a barber, pick a time and pay online. Reminders by SMS.</p>";</script></body></html>');
  }
  if (req.url === '/file.pdf') return send(200, 'application/pdf', '%PDF-1.4');
  if (req.url === '/to-private') { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' }); return res.end(); }
  return send(404, 'text/plain', 'not found');
});

const agent = new WhatsAppAgent();
let n = 0;
const ask = (body) => agent.handleIncomingMessage({ from: `23320010${String(++n).padStart(4, '0')}`, body, workspaceId: WS, session: 'default', userId: 'admin-1' });

(async () => {
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${site.address().port}`;

  // Finding links in a message.
  {
    const urls = linkReader.extractUrls('Can you build something like www.amafashion.com.gh? or https://x.io/shop?y=1, and email me at kofi@gmail.com');
    assert.deepStrictEqual(urls, ['https://www.amafashion.com.gh/', 'https://x.io/shop?y=1']);
    assert.deepStrictEqual(linkReader.extractUrls('see ama.shop and b.com and c.com'), ['https://ama.shop/', 'https://b.com/'], 'at most 2 links');
    assert.deepStrictEqual(linkReader.extractUrls('hello, how much is a website?'), []);
    console.log('✓ links are found in messages (http, www., bare domains; not email addresses; at most 2)');
  }

  // Reading pages.
  {
    const shop = await linkReader.readLink(`${base}/shop`);
    assert.strictEqual(shop.ok, true, JSON.stringify(shop));
    assert.strictEqual(shop.title, 'Ama Fashion - Online Store');
    assert(shop.description.includes('Pay with MoMo'));
    assert.deepStrictEqual(shop.headings, ['New arrivals', 'Cart']);
    assert(!shop.text.includes('ignore me'), 'scripts are not read as text');
    const app = await linkReader.readLink(`${base}/app`);
    assert(app.ok && app.text.includes('Book a haircut') && app.text.includes('Reminders by SMS'), `modern site rendered in a browser: ${JSON.stringify(app)}`);
    assert.strictEqual((await linkReader.readLink(`${base}/file.pdf`)).ok, false);
    assert.strictEqual((await linkReader.readLink(`${base}/missing`)).ok, false);
    console.log('✓ pages are read: title, description, headings, text (modern sites in a real browser); PDFs and broken links are reported');
  }

  // Never private addresses (checked as in production).
  {
    process.env.CC_TESTING = '0';
    for (const u of ['http://localhost:4000/api', 'http://127.0.0.1/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://169.254.169.254/latest', 'file:///etc/passwd', 'ftp://x.com/']) {
      assert.strictEqual(linkReader.isPublicUrl(u), false, u);
    }
    assert.strictEqual(linkReader.isPublicUrl('https://codecraft-wheat.vercel.app'), true);
    linkReader._clearCache();
    const r = await linkReader.readLink(`${base}/to-private`);
    assert.strictEqual(r.ok, false, 'a local address (and a redirect to cloud metadata) is never opened');
    process.env.CC_TESTING = '1';
    console.log('✓ private, local and cloud-metadata addresses are never opened (also after a redirect)');
  }

  // The agent uses what it read - no extra AI call - and may repeat the customer's own link.
  {
    linkReader._clearCache();
    aiCalls = 0;
    modelAnswer = JSON.stringify({ reply: `Yes! ${base}/shop is an online store with a cart and MoMo payments - we build stores like that.`, hold: false, reason: '' });
    const r = await ask(`Good morning, can you build a site like ${base}/shop ?`);
    assert.strictEqual(aiCalls, 1, 'one AI call (the reply) - reading the link costs nothing extra');
    assert(lastPrompt.system.includes("Links the customer shared"));
    assert(lastPrompt.system.includes('Title: Ama Fashion - Online Store'));
    assert(lastPrompt.system.includes('Headings: New arrivals | Cart'));
    assert.strictEqual(r.held, false, `the customer's own link is fine in the reply: ${r.reason}`);
    assert.strictEqual(sent.length, 1);
    console.log('✓ Ian answers using what the link shows (no extra AI call); repeating the customer\'s own link is allowed');
  }

  // A link that can't be opened: Ian is told so, and a made-up link still waits.
  {
    modelAnswer = JSON.stringify({ reply: 'I couldn\'t open that link - what do you like about the site?', hold: false, reason: '' });
    await ask(`like this one ${base}/missing`);
    assert(lastPrompt.system.includes("couldn't be opened") && lastPrompt.system.includes("Don't pretend you've seen it"));
    modelAnswer = JSON.stringify({ reply: 'Have a look at www.some-other-site.com for ideas.', hold: false, reason: '' });
    const r = await ask('any examples?');
    assert.strictEqual(r.held, true, 'a link the customer never sent (and not in your knowledge) still waits for you');
    console.log('✓ unopenable links are flagged to Ian; links he invents still wait for your approval');
  }

  site.close();
  console.log('All link-reader checks passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
