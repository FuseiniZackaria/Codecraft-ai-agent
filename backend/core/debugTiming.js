/**
 * Step timings for the chat path, off unless DEBUG includes "chat" (or "*").
 *   DEBUG=chat npm run dev
 * Usage: const t = startTimer('chat/stream'); ... t.mark('loaded history', { rows: 12 });
 * Each line shows ms since the timer started and ms since the previous mark.
 */
function enabled() {
  return /(^|,)\s*(chat|\*)\s*(,|$)/.test(process.env.DEBUG || '');
}

function startTimer(label) {
  if (!enabled()) return { mark() {}, enabled: false };
  const start = Date.now();
  let last = start;
  return {
    enabled: true,
    mark(step, extra) {
      const now = Date.now();
      const tail = extra ? ` ${JSON.stringify(extra)}` : '';
      console.log(`[timing ${label}] +${String(now - start).padStart(6)}ms (step ${String(now - last).padStart(6)}ms) ${step}${tail}`);
      last = now;
    },
  };
}

module.exports = { startTimer };
