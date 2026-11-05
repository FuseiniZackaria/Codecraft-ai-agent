// Documents (Settings -> General -> Documents): upload PDF / Word / text / CSV /
// Excel over the real HTTP routes, background processing with a status, the
// text split into searchable sections, replace (re-processed, old sections
// swapped out), delete, failures explained, workspaces kept apart, and the
// WhatsApp agent using the new version on its very next reply.
// Real sample files are generated here; nothing leaves the machine.

process.env.CC_TESTING = '1';
process.env.CC_FORCE_MEMORY_STORE = '1';
process.env.CC_FORCE_MOCK_PROVIDER = '1';
process.env.WHATSAPP_PROVIDER = 'waha';
delete process.env.WA_AUTO_REPLY;

const assert = require('assert');
const express = require('express');
const JSZip = require('jszip');
const XLSX = require('xlsx');
const mockProvider = require('../core/providers/mockProvider');
const orchestrator = require('../core/orchestrator');
const notifications = require('../core/notifications');
const memory = require('../memory');
const store = require('../core/knowledge/store');
const documents = require('../core/knowledge/documents');
const retrieval = require('../core/knowledge/retrieval');
const WhatsAppAgent = require('../agents/whatsapp/WhatsAppAgent');

const WS_A = 'aaaaaaaa-0000-0000-0000-0000000000d1';
const WS_B = 'bbbbbbbb-0000-0000-0000-0000000000d2';

let lastPrompt = null;
mockProvider.complete = async (req) => { lastPrompt = req; return { provider: 'mock', text: JSON.stringify({ reply: 'Sure!', hold: false, reason: '' }), costEstimate: 0 }; };
orchestrator.approveTask = async (taskId) => ({ ...(await memory.getTask(taskId)), status: 'done' });
notifications.notifyOwnerFyi = async () => 'sent';
notifications.notifyOwnerPendingApproval = async () => ({});
memory.getBusinessProfile = async () => ({ business_name: 'Ama Bakery' });

// ---- sample files ----
function pdfWith(lines) {
  const content = `BT /F1 12 Tf 20 200 Td 14 TL ${lines.map((l) => `(${l}) Tj T*`).join(' ')} ET`;
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 300]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${content.length}>>stream\n${content}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj${o}endobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

async function docxWith(paragraphs) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

function xlsxWith(rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Prices');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const b64 = (buf) => Buffer.from(buf).toString('base64');

// ---- the real routes behind a fake login ----
const app = express();
app.use(express.json({ limit: '35mb' }));
app.use((req, _res, next) => { req.user = { id: 'user-1', role: 'admin', workspaceId: req.get('x-ws') || null, workspaceRole: 'owner' }; next(); });
app.use('/api/knowledge', require('../api/knowledgeRoutes'));
let base;
async function call(method, path, body, ws = WS_A) {
  const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', 'x-ws': ws }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}
const upload = (filename, buf, ws = WS_A) => call('POST', '/api/knowledge/documents', { filename, mime_type: 'application/octet-stream', data: b64(buf) }, ws);
const byName = async (name, ws = WS_A) => (await call('GET', '/api/knowledge/documents', null, ws)).body.documents.find((d) => d.filename === name);

const agent = new WhatsAppAgent();
const ask = (body, workspaceId = WS_A) => agent.handleIncomingMessage({ from: '233200000011', body, workspaceId, session: 'default', userId: 'admin-1' });

(async () => {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  // 1. Every supported type is read correctly.
  {
    const files = [
      ['menu.pdf', pdfWith(['Jollof rice with chicken: GHS 45', 'Waakye special: GHS 35'])],
      ['policy.docx', await docxWith(['Refund policy', 'Cakes can be returned within 24 hours with the receipt.'])],
      ['hours.txt', Buffer.from('﻿Opening hours\r\nMonday to Saturday 8am - 6pm\r\nClosed on Sundays')],
      ['prices.csv', Buffer.from('Item,Price,Size\nMeat pie,GHS 15,Small\n"Birthday cake, chocolate",GHS 250,8 inch\n')],
      ['drinks.xlsx', xlsxWith([['Drink', 'Price'], ['Sobolo', 'GHS 10'], ['Asaana', 'GHS 12']])],
    ];
    for (const [name, buf] of files) {
      const r = await upload(name, buf);
      assert.strictEqual(r.status, 201, `${name}: ${JSON.stringify(r.body)}`);
      assert.strictEqual(r.body.document.status, 'processing', 'answers straight away; processing runs in the background');
      assert(!('storage_path' in r.body.document), 'internal storage path is not sent to the browser');
    }
    await documents._waitForProcessing();
    const text = async (name) => {
      const d = await byName(name);
      assert.strictEqual(d.status, 'ready', `${name}: ${d.status} ${d.error || ''}`);
      assert(d.chunk_count >= 1);
      return (await call('GET', `/api/knowledge/documents/${d.id}/text`)).body.sections.join('\n');
    };
    assert((await text('menu.pdf')).includes('Jollof rice with chicken: GHS 45'));
    assert((await text('policy.docx')).includes('returned within 24 hours'));
    const hours = await text('hours.txt');
    assert(hours.startsWith('Opening hours\nMonday to Saturday'), 'BOM and Windows line endings cleaned');
    const csv = await text('prices.csv');
    assert(csv.includes('Item: Birthday cake, chocolate | Price: GHS 250 | Size: 8 inch'), csv);
    assert((await text('drinks.xlsx')).includes('Drink: Sobolo | Price: GHS 10'));
    console.log('✓ PDF, Word, text, CSV and Excel files are read; spreadsheet rows become "Column: value" lines');
  }

  // 2. Bad uploads get a clear reason.
  {
    let r = await upload('notes.doc', Buffer.from('old word'));
    assert.strictEqual(r.status, 400);
    assert(/Save as.*docx/.test(r.body.details?.[0] || r.body.error), JSON.stringify(r.body));
    r = await upload('photo.png', Buffer.from('png'));
    assert.strictEqual(r.status, 400);
    r = await call('POST', '/api/knowledge/documents', { filename: 'big.txt', data: b64(Buffer.alloc(documents.MAX_BYTES + 1, 97)) });
    assert.strictEqual(r.status, 400);
    assert(/too big/.test(JSON.stringify(r.body)));
    r = await call('POST', '/api/knowledge/documents', { filename: 'empty.txt', data: '' });
    assert.strictEqual(r.status, 400);
    console.log('✓ unsupported types (incl. old .doc), oversized and empty files are refused with a clear reason');
  }

  // 3. Unreadable content fails with an explanation, and can be processed again.
  {
    await upload('scan.pdf', pdfWith([]));
    await upload('broken.docx', Buffer.from('this is not really a word file'));
    await documents._waitForProcessing();
    const scan = await byName('scan.pdf');
    assert.strictEqual(scan.status, 'failed');
    assert(/scanned PDF/.test(scan.error), scan.error);
    const broken = await byName('broken.docx');
    assert.strictEqual(broken.status, 'failed');
    assert(/may be damaged/.test(broken.error), broken.error);
    const r = await call('POST', `/api/knowledge/documents/${broken.id}/reprocess`);
    assert.strictEqual(r.body.document.status, 'processing');
    await documents._waitForProcessing();
    assert.strictEqual((await byName('broken.docx')).status, 'failed');
    console.log('✓ a scanned PDF or a broken file is marked failed with a plain explanation; "process again" works');
  }

  // 4. The agent uses the documents on its next reply.
  {
    await ask('How much is the jollof?');
    assert(lastPrompt.system.includes("From the business's documents"), 'documents in the prompt');
    assert(lastPrompt.system.includes('(menu.pdf)') && lastPrompt.system.includes('Jollof rice with chicken: GHS 45'));
    assert(!lastPrompt.system.includes('broken.docx'), 'failed documents are never used');
    console.log('✓ the agent reads the documents on its next reply (failed ones never)');
  }

  // 5. Replace: re-processed automatically; the new version is used, the old one never again.
  {
    const menu = await byName('menu.pdf');
    const r = await call('PUT', `/api/knowledge/documents/${menu.id}`, { filename: 'menu-november.pdf', data: b64(pdfWith(['Jollof rice with chicken: GHS 50', 'Fried rice: GHS 40'])) });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.document.status, 'processing');
    await documents._waitForProcessing();
    const updated = await byName('menu-november.pdf');
    assert.strictEqual(updated.id, menu.id, 'same entry, new file');
    assert.strictEqual(updated.status, 'ready');
    await ask('How much is the jollof?');
    assert(lastPrompt.system.includes('GHS 50') && !lastPrompt.system.includes('GHS 45'), 'new prices only');
    console.log('✓ replacing a file re-processes it and the agent uses only the new version');
  }

  // 6. A replace that can't be read removes the old text too (never answer from an outdated file).
  {
    const hours = await byName('hours.txt');
    await call('PUT', `/api/knowledge/documents/${hours.id}`, { filename: 'hours.pdf', data: b64(pdfWith([])) });
    await documents._waitForProcessing();
    assert.strictEqual((await byName('hours.pdf')).status, 'failed');
    await ask('When are you open?');
    assert(!lastPrompt.system.includes('Closed on Sundays'), 'old version no longer used');
    console.log('✓ if a replacement fails, the old version is not used either');
  }

  // 7. Delete; other workspaces never see or touch these.
  {
    const policy = await byName('policy.docx');
    assert.strictEqual((await call('DELETE', `/api/knowledge/documents/${policy.id}`, null, WS_B)).status, 404, "B can't delete A's file");
    assert.strictEqual((await call('GET', `/api/knowledge/documents/${policy.id}/text`, null, WS_B)).status, 404, "B can't read A's file");
    assert.strictEqual((await call('PUT', `/api/knowledge/documents/${policy.id}`, { filename: 'x.txt', data: b64(Buffer.from('hacked')) }, WS_B)).status, 404);
    assert.deepStrictEqual((await call('GET', '/api/knowledge/documents', null, WS_B)).body.documents, []);
    await ask('Can I return a cake?', WS_B);
    assert(!lastPrompt.system.includes('24 hours'), "B's agent never sees A's documents");

    assert.strictEqual((await call('DELETE', `/api/knowledge/documents/${policy.id}`)).status, 200);
    assert.strictEqual(await byName('policy.docx'), undefined);
    assert.deepStrictEqual(await store.listChunks(WS_A, { documentId: policy.id }), [], 'its text is gone too');
    await ask('Can I return a cake?');
    assert(!lastPrompt.system.includes('24 hours'), 'deleted = never used');
    console.log('✓ delete removes the file and its text; other businesses never see or change it');
  }

  // 8. Big documents: only the best-matching sections are sent.
  {
    const lines = [];
    for (let i = 0; i < 300; i++) lines.push(`Product ${i}: plain flour bag number ${i}, price on request.`);
    lines.splice(150, 0, 'Wedding cakes: three tiers, order two weeks ahead, delivery included in Accra.');
    await upload('catalogue.txt', Buffer.from(lines.join('\n')), WS_B);
    await documents._waitForProcessing();
    const found = await retrieval.forMessage(WS_B, 'do you make wedding cakes?');
    assert(found.docs.length >= 1 && found.docs.length <= retrieval.MAX_DOC_SECTIONS, String(found.docs.length));
    assert(found.docs[0].content.includes('Wedding cakes: three tiers'), found.docs[0].content.slice(0, 80));
    assert.strictEqual(found.docs[0].label, 'D1');
    assert.strictEqual(found.docs[0].filename, 'catalogue.txt');
    console.log('✓ big documents: the sections that match the question are picked and labelled [D1]...');
  }

  // 9. Chunking keeps sections a readable size.
  {
    const long = Array.from({ length: 50 }, (_, i) => `Sentence number ${i} about our bakery and its products.`).join(' ');
    const parts = documents.chunk(`Intro\n\n${long}`);
    assert(parts.length > 1 && parts.every((p) => p.length <= 1250), parts.map((p) => p.length).join(','));
    assert(parts.join(' ').includes('Sentence number 49'), 'nothing lost');
    console.log('✓ long text is split into ~1,200-character sections without losing anything');
  }

  server.close();
  console.log('All knowledge document checks passed.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
