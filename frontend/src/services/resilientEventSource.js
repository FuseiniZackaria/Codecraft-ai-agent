const BACKOFF_STEPS = [1000, 2000, 5000, 10000, 30000];
const MAX_RETRIES = 10;

export function createResilientEventSource(urlOrFn, onMessage, onStatusChange) {
  let es = null;
  let retries = 0;
  let timer = null;
  let closed = false;

  async function connect() {
    if (closed) return;
    const url = typeof urlOrFn === 'function' ? await urlOrFn() : urlOrFn;
    es = new EventSource(url);

    es.onopen = () => {
      retries = 0;
      onStatusChange?.('live');
    };

    es.onmessage = onMessage;

    es.onerror = () => {
      es.close();
      es = null;
      if (closed) return;
      if (retries >= MAX_RETRIES) {
        onStatusChange?.('failed');
        return;
      }
      const delay = BACKOFF_STEPS[Math.min(retries, BACKOFF_STEPS.length - 1)];
      retries++;
      onStatusChange?.('reconnecting');
      timer = setTimeout(connect, delay);
    };
  }

  connect();

  return {
    close() {
      closed = true;
      clearTimeout(timer);
      if (es) { es.close(); es = null; }
    },
  };
}
