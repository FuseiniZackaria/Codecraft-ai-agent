const { EventEmitter } = require('events');

// Single shared bus for the whole process. SSE clients subscribe to 'event';
// anything that wants to broadcast a live activity update emits on it.
// Deliberately separate from persistence (memory.audit) - this is just the
// live-push side; activityLog.js below handles doing both together.
const bus = new EventEmitter();
bus.setMaxListeners(50); // generous - each open SSE connection adds one listener

module.exports = bus;
