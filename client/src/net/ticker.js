// Interval timer driven by a Worker (Blob URL): keeps the hosted room ticking at full rate in background tabs,
// where main-thread timers get throttled. Falls back to setInterval.
export function startTicker(hz, fn) {
  const ms = 1000 / hz;
  if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
    try {
      const src = `setInterval(() => postMessage(0), ${ms});`;
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      const worker = new Worker(url);
      worker.onmessage = () => fn();
      return () => {
        worker.terminate();
        URL.revokeObjectURL(url);
      };
    } catch {
      // CSP or old browser: fall through
    }
  }
  const id = setInterval(fn, ms);
  return () => clearInterval(id);
}
