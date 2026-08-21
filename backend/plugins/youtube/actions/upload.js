const fs = require('fs');
const composio = require('../../../core/composio');

// IMPORTANT, please read before relying on this action:
// Two things here are best-evidenced guesses, NOT verified against a live
// Composio account (no credentials were available to confirm either
// directly):
//
// 1. The tool slug. Composio's YouTube toolkit consistently describes this
//    action as "Uploads a video to YouTube using multipart upload in a
//    single request" across their docs, but never publishes the exact
//    machine-readable slug anywhere searchable. Following the same "mirror
//    the toolkit's own description" pattern that worked for Reddit
//    (REDDIT_POST_REDDIT_COMMENT) and this codebase's own YouTube comment
//    action (YOUTUBE_POST_COMMENT_ON_VIDEO), the guess here is
//    YOUTUBE_MULTIPART_UPLOAD_VIDEO - "multipart" appears to be a
//    load-bearing part of how Composio names/describes this specific tool,
//    not just an implementation detail mentioned in passing.
//
// 2. The file-staging call shape. Composio genuinely requires local files
//    to be staged via composio.files.upload() before they can be
//    referenced in a tool call (confirmed for real - this exact
//    requirement surfaced as a live SDK warning earlier in this project,
//    for Gmail's attachment field). See core/composio.js's uploadFile() for
//    the specific uncertainty there.
//
// If either guess is wrong, the resulting error will be surfaced clearly
// (see composio.execute()'s error handling) rather than silently
// mishandled - check that error message first if this fails.
const ACTION_SLUG = 'YOUTUBE_MULTIPART_UPLOAD_VIDEO';

module.exports = {
  name: 'upload',
  permission: 'youtube.upload',
  irreversible: true, // publishing a real, public-facing video - hard to undo -> approval gate applies

  async run({ filePath, title, description, privacyStatus = 'unlisted', tags }) {
    if (!filePath) throw new Error('upload requires "filePath"');
    if (!title) throw new Error('upload requires "title"');
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

    const fileDescriptor = await composio.uploadFile(filePath, ACTION_SLUG, 'youtube');

    const result = await composio.execute(
      ACTION_SLUG,
      {
        file: fileDescriptor,
        title,
        description: description || '',
        // Deliberately defaults to 'unlisted', not 'public' - even after a
        // human approval step, a video going public is instantly
        // shareable/discoverable and hard to fully walk back. 'unlisted'
        // still gives you a real link to check before ever making it public.
        privacyStatus,
        tags: tags || [],
      },
      'youtube'
    );

    return { status: 'uploaded', title, privacyStatus, ...result };
  },
};
