// WebAudio engine with a shared master output (for speakers + recording)
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<string, AudioBuffer>();

function ensureCtx() {
  if (!ctx) {
    const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 1.0;
    master.connect(ctx.destination); // normal playback
  }
  return ctx!;
}

/** Expose the master node so recorder can tap it */
export function getMaster(): GainNode {
  ensureCtx();
  return master!;
}

/** Load one sample */
async function loadOne(key: string, url: string) {
  const C = ensureCtx();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  const buf = await res.arrayBuffer();
  const decoded = await C.decodeAudioData(buf);
  buffers.set(key, decoded);
}

/** Load all samples in a {name:url} map */
export async function loadAll(map: Record<string, string>) {
  await Promise.all(Object.entries(map).map(([k,u]) => loadOne(k,u)));
}

/** Play by key (polyphonic) */
export function play(key: string, gain = 1.0) {
  const C = ensureCtx();
  const buf = buffers.get(key);
  if (!buf) return;
  const src = C.createBufferSource();
  src.buffer = buf;

  const g = C.createGain();
  g.gain.value = Math.max(0, Math.min(1, gain));

  src.connect(g).connect(getMaster());
  src.start();
}
