const assert = require('assert');
const Module = require('module');

// Mock the document extractor - this test verifies chat.js's OWN routing,
// text-combination, and error-handling logic around document attachments,
// not the real mammoth/xlsx libraries themselves (those need verification
// in a real environment where npm install actually works).
const mockExtractor = {
  isExtractable: (mediaType) =>
    [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ].includes(mediaType),
  extractText: async (attachment) => {
    if (attachment.filename === 'broken.docx') throw new Error('Corrupted file');
    if (attachment.mediaType.includes('word')) return 'This is the document content';
    return '--- Sheet: Sheet1 ---\ncol1,col2\nval1,val2';
  },
};

const originalRequire = Module.prototype.require;
Module.prototype.require = function (id, ...args) {
  if (id === './documentExtractor') return mockExtractor;
  return originalRequire.call(this, id, ...args);
};

const chat = require('../core/chat');
const mockProvider = require('../core/providers/mockProvider');

async function main() {
  let capturedCall = null;
  const originalComplete = mockProvider.complete;
  mockProvider.complete = async (args) => {
    capturedCall = args;
    return { text: 'Analysis complete', provider: 'mock', costEstimate: 0 };
  };

  const docxAttachment = {
    mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    data: Buffer.from('placeholder').toString('base64'),
    filename: 'report.docx',
  };

  await chat.handleMessage('Summarize this', [], [docxAttachment]);
  assert(capturedCall.prompt.includes('This is the document content'), 'extracted docx text should reach the prompt');
  assert(!capturedCall.content, 'should use the plain prompt path when there are no native attachments');
  console.log('✓ a pure docx attachment is extracted and reaches the prompt via the plain text path');

  const xlsxAttachment = {
    mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    data: 'ZmFrZQ==',
    filename: 'data.xlsx',
  };
  await chat.handleMessage('What does this show?', [], [xlsxAttachment]);
  assert(capturedCall.prompt.includes('col1,col2'), 'extracted spreadsheet CSV should reach the prompt');
  assert(capturedCall.prompt.includes('Sheet1'), 'sheet name should be included for context');
  console.log('✓ a pure xlsx attachment is extracted and its data reaches the prompt');

  const imageAttachment = { mediaType: 'image/png', data: 'ZmFrZQ==', filename: 'photo.png' };
  await chat.handleMessage('Check both', [], [imageAttachment, docxAttachment]);
  assert(Array.isArray(capturedCall.content), 'should use the multimodal content path when a native attachment is present');
  const textBlock = capturedCall.content.find((b) => b.type === 'text');
  assert(textBlock.text.includes('This is the document content'), 'extracted docx text should be folded into the trailing text block');
  assert(capturedCall.content.some((b) => b.type === 'image'), 'the image should still be sent as a real multimodal block');
  console.log('✓ mixed image + docx attachments are both handled correctly in the same message');

  const result4 = await chat.handleMessage('Read this', [], [{ mediaType: 'application/zip', data: 'ZmFrZQ==', filename: 'archive.zip' }]);
  assert(result4.reply.includes('archive.zip'));
  assert(result4.reply.includes("isn't a format"));
  console.log('✓ genuinely unsupported file types are still rejected with a clear message');

  const brokenDocx = { ...docxAttachment, filename: 'broken.docx' };
  const result5 = await chat.handleMessage('Read this', [], [brokenDocx]);
  assert(result5.reply.includes('broken.docx') && result5.reply.includes('Corrupted file'), 'extraction failure should be surfaced clearly');
  console.log('✓ a document extraction failure is surfaced clearly instead of crashing the request');

  mockProvider.complete = originalComplete;
  Module.prototype.require = originalRequire;

  console.log('\nAll document handling checks passed.');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
