// Simple WebAudio manager for DrumKit
let ctx: AudioContext | null = null;
const buffers: Record<string, AudioBuffer> = {};

// Lazy init audio context
function getCtx() {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

// Load a single sample
async function loadSample(name: string, url: string) {
  const res = await fetch(url);
  const arr = await res.arrayBuffer();
  const buf = await getCtx().decodeAudioData(arr);
  buffers[name] = buf;
}

// Load a whole set of samples
export async function loadAll(map: Record<string, string>) {
  await Promise.all(Object.entries(map).map(([n, u]) => loadSample(n, u)));
}

// Play a sample
export function play(name: string, time = 0) {
  const buf = buffers[name];
  if (!buf) return;
  const src = getCtx().createBufferSource();
  src.buffer = buf;
  src.connect(getCtx().destination);
  src.start(getCtx().currentTime + time);
}
