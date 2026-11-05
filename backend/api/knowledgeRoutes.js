const express = require('express');
const store = require('../core/knowledge/store');
const qa = require('../core/knowledge/qa');
const { requireKnowledgeEditor } = require('../core/workspaceAccess');

/**
 * /api/knowledge - the caller's workspace knowledge base.
 *
 *   GET    /qa          all Q&A entries (newest first)
 *   POST   /qa          add one        { question, answer, enabled? }
 *   PATCH  /qa/:id      change one     { question?, answer?, enabled? }
 *   DELETE /qa/:id      delete one
 *
 * Every change is used by the WhatsApp agent from its next reply (nothing is cached).
 * Documents: see below.
 */

const router = express.Router();
router.use(requireKnowledgeEditor);

function fail(res, err) {
  if (err.code === 'INVALID') {
    return res.status(400).json({ error: err.details ? 'Please fix this and try again.' : err.message, details: err.details || [err.message] });
  }
  if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
  if (err.code === 'RATE_LIMIT') return res.status(429).json({ error: err.message });
  if (err.code === 'MIGRATION_MISSING') return res.status(503).json({ error: err.message, migrationMissing: true });
  console.warn(`[knowledge] ${err.message}`);
  return res.status(500).json({ error: err.message });
}

router.get('/qa', async (req, res) => {
  try {
    const entries = await store.listQa(req.user.workspaceId);
    res.json({ entries, limits: qa.LIMITS });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/qa', async (req, res) => {
  try {
    const entry = await qa.create(req.user.workspaceId, req.body || {}, req.user);
    res.status(201).json({ entry });
  } catch (err) {
    fail(res, err);
  }
});

router.patch('/qa/:id', async (req, res) => {
  try {
    const entry = await qa.update(req.user.workspaceId, req.params.id, req.body || {});
    res.json({ entry });
  } catch (err) {
    fail(res, err);
  }
});

router.delete('/qa/:id', async (req, res) => {
  try {
    await qa.remove(req.user.workspaceId, req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    fail(res, err);
  }
});

// ---------- "Correct this answer" ----------
//   POST /corrections   { kind: 'test'|'whatsapp', messageId, question, answer } -> saved as a Q&A entry
//   GET  /corrections   { "test:<id>": qaId, "whatsapp:<id>": qaId } - which replies were corrected

router.post('/corrections', async (req, res) => {
  try {
    const result = await qa.correct(req.user.workspaceId, req.body || {}, req.user);
    res.status(result.created ? 201 : 200).json(result);
  } catch (err) {
    fail(res, err);
  }
});

router.get('/corrections', async (req, res) => {
  try {
    res.json({ corrections: await qa.corrections(req.user.workspaceId) });
  } catch (err) {
    fail(res, err);
  }
});

// ---------- documents ----------
//   GET    /documents               the list with status
//   POST   /documents               upload   { filename, mime_type, data (base64) }
//   PUT    /documents/:id           replace the file (re-processed automatically)
//   POST   /documents/:id/reprocess process again (after a failure)
//   DELETE /documents/:id           delete the file and its text
//   GET    /documents/:id/text      the text the agent reads (first sections)

const documents = require('../core/knowledge/documents');

const publicDoc = (d) => {
  const { storage_path, uploaded_by, workspace_id, ...rest } = d; // internal details stay on the server
  return rest;
};

router.get('/documents', async (req, res) => {
  try {
    const list = await documents.list(req.user.workspaceId);
    res.json({ documents: list.map(publicDoc), accept: documents.ACCEPT, maxBytes: documents.MAX_BYTES });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/documents', async (req, res) => {
  try {
    const doc = await documents.upload(req.user.workspaceId, req.body || {}, req.user);
    res.status(201).json({ document: publicDoc(doc) });
  } catch (err) {
    fail(res, err);
  }
});

router.put('/documents/:id', async (req, res) => {
  try {
    const doc = await documents.replace(req.user.workspaceId, req.params.id, req.body || {}, req.user);
    res.json({ document: publicDoc(doc) });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/documents/:id/reprocess', async (req, res) => {
  try {
    const doc = await documents.reprocess(req.user.workspaceId, req.params.id);
    res.json({ document: publicDoc(doc) });
  } catch (err) {
    fail(res, err);
  }
});

router.delete('/documents/:id', async (req, res) => {
  try {
    await documents.remove(req.user.workspaceId, req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    fail(res, err);
  }
});

router.get('/documents/:id/text', async (req, res) => {
  try {
    const doc = await store.getDocument(req.user.workspaceId, req.params.id);
    if (!doc) return res.status(404).json({ error: 'That document was not found.' });
    const sections = await store.listChunks(req.user.workspaceId, { documentId: doc.id, limit: 30 });
    res.json({ document: publicDoc(doc), sections: sections.map((s) => s.content), shown: sections.length, total: doc.chunk_count });
  } catch (err) {
    fail(res, err);
  }
});

// ---------- test chat ----------
//   GET    /test-chat    the conversation so far
//   POST   /test-chat    { text } -> the agent's reply (never sent to anyone)
//   DELETE /test-chat    start over

const testChat = require('../core/knowledge/testChat');

router.get('/test-chat', async (req, res) => {
  try {
    const messages = await store.listTestMessages(req.user.workspaceId, 100);
    res.json({ messages, maxText: testChat.MAX_TEXT });
  } catch (err) {
    fail(res, err);
  }
});

router.post('/test-chat', async (req, res) => {
  try {
    const result = await testChat.send(req.user.workspaceId, req.body?.text, req.user);
    res.json(result);
  } catch (err) {
    fail(res, err);
  }
});

router.delete('/test-chat', async (req, res) => {
  try {
    await store.clearTestMessages(req.user.workspaceId);
    res.json({ cleared: true });
  } catch (err) {
    fail(res, err);
  }
});

module.exports = router;
