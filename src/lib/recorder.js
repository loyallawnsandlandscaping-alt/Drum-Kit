// ===== src/lib/recorder.js =====

export const RecorderEnhance = (() => {
  let recording = false;
  let t0 = 0;
  let buf = [];
  let loopLenMs = 8000; // default 8s
  let onPlay;

  function setLoopSeconds(s) { loopLenMs = Math.max(1000, (s|0) * 1000); }
  function setOnPlay(fn) { onPlay = fn; }

  function start() {
    recording = true;
    t0 = performance.now();
    buf = [];
  }
  function stop() { recording = false; }

  function note(padId) {
    if (!recording) return;
    buf.push({ t: performance.now() - t0, padId });
  }

  let raf = 0;
  function playLoop() {
    if (!onPlay || buf.length === 0) return;
    const start = performance.now();
    function tick() {
      const now = performance.now() - start;
      const tNow = now % loopLenMs;
      for (const ev of buf) {
        if (Math.abs(tNow - ev.t) < 12) onPlay(ev.padId);
      }
      raf = requestAnimationFrame(tick);
    }
    stopLoop();
    raf = requestAnimationFrame(tick);
  }

  function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  return { setLoopSeconds, setOnPlay, start, stop, note, playLoop, stopLoop };
})();
