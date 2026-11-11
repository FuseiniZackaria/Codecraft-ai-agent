// The same 9:16 / 16:9 framing the backend's video.edit plugin uses - one copy,
// in backend/core/video/framing.js (the Dockerfile copies it to the same path).
module.exports = require('../../backend/core/video/framing');
