// src/audio.ts
let ctx: AudioContext | null = null;
const buffers: Record<string, AudioBuffer> = {};

function getCtx() {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

async function loadSample(name: string, url: string) {
  const res = await fetch(url);
  const arr = await res.arrayBuffer();
  const buf = await getCtx().decodeAudioData(arr);
  buffers[name] = buf;
}

export async function loadAll(map: Record<string, string>) {
  await Promise.all(Object.entries(map).map(([n, u]) => loadSample(n, u)));
}

export function play(name: string, when = 0) {
  const b = buffers[name];
  if (!b) return;
  const c = getCtx();
  const src = c.createBufferSource();
  src.buffer = b;
  src.connect(c.destination);
  src.start(c.currentTime + when);
}
