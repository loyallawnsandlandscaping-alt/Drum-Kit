// src/audioEngine.js
// Low-latency WebAudio engine for 9 WAVs in /public
//
// Public API:
//   await initAudio()            // preload & decode (optional; auto on first play)
//   ensureUnlocked()             // resume context on first user gesture (iOS/Safari)
//   arm()                        // helper: initAudio() + ensureUnlocked()
//   armAfterCapture()            // alias to arm(); call right after photo capture
//   playPad(copyId)              // trigger sound for a pad/copy id
//   assignPad(copyId, soundId)   // pin a pad to a specific sound
//   setMasterGain(0..1)          // master output gain
//   getAssignments()             // { copyId -> soundId }
//   loadSoundsFrom(list|map)     // optional runtime override of sounds map
//
// Behavior:
//   - Uses /public/sounds.json if present; otherwise falls back to the 9 defaults.
//   - First time a pad hits, it’s assigned a sound via round-robin unless assigned explicitly.
//   - Very short envelope prevents clicks while keeping hits tight.

let ctx = null;
let master = null;
let unlocked = false;

const cache = new Map();   // url -> AudioBuffer
const idToUrl = new Map(); // soundId -> url
const padToId = new Map(); // copyId -> soundId
let defaultIds = [];       // order used for round-robin

let rrIndex = 0;

const DEFAULT_SOUNDS = [
  { id: "clap-1",       url: "/clap-1.wav" },
  { id: "clap-fat",     url: "/clap-fat.wav" },
  { id: "closedhat-1",  url: "/closedhat-1.wav" },
  { id: "deepkick",     url: "/deepkick.wav" },
  { id: "kick-1",       url: "/kick-1.wav" },
  { id: "openhat",      url: "/openhat.wav" },
  { id: "snare-1",      url: "/snare-1.wav" },
  { id: "tom-1",        url: "/tom-1.wav" },
  { id: "tom-2",        url: "/tom-2.wav" },
];

// ---------- Public API ----------

export async function initAudio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: "interactive",
    });
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  await loadSoundMap();
  await preloadAll();
}

export async function ensureUnlocked() {
  if (!ctx) await initAudio();
  // iOS/Safari requires a user gesture before audio can start
  if (ctx.state === "suspended") {
    try { await ctx.resume(); } catch {}
  }
  unlocked = true;
}

/** Convenience helper: call this after your photo is taken (or any user gesture). */
export async function arm() {
  await initAudio().catch(()=>{});
  await ensureUnlocked().catch(()=>{});
}

/** Alias for clarity in app code when used after capture. */
export const armAfterCapture = arm;

export function setMasterGain(v) {
  if (!master) return;
  const n = Number(v);
  master.gain.value = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : master.gain.value;
}

export function assignPad(copyId, soundId) {
  if (!idToUrl.has(soundId)) return false;
  padToId.set(copyId, soundId);
  return true;
}

export function getAssignments() {
  const out = {};
  for (const [k, v] of padToId.entries()) out[k] = v;
  return out;
}

export async function playPad(copyId) {
  if (!ctx) await initAudio();

  // Best effort unlock if not already done (won’t throw if not allowed yet)
  if (!unlocked && ctx.state === "suspended") {
    try { await ctx.resume(); unlocked = true; } catch {}
  }

  const soundId = resolveSoundForPad(copyId);
  const url = idToUrl.get(soundId);
  if (!url) return;

  const buf = await getBuffer(url);
  if (!buf) return;

  const t = ctx.currentTime;

  // One-shot source
  const src = ctx.createBufferSource();
  src.buffer = buf;

  // Fast, clickless envelope (tight attack, short tail)
  const v = ctx.createGain();
  v.gain.setValueAtTime(0.0001, t);
  v.gain.exponentialRampToValueAtTime(1.0, t + 0.002);
  // keep tail inside buffer length; shorter of 0.9s or buffer duration
  v.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(0.9, buf.duration));

  src.connect(v);
  v.connect(master);
  src.start();
}

/**
 * Optional: override sound mapping at runtime.
 * Accepts:
 *   - Array: [{id, url}, ...]
 *   - Object map: { id: url, ... }
 */
export function loadSoundsFrom(listOrMap) {
  idToUrl.clear();
  defaultIds = [];

  if (Array.isArray(listOrMap)) {
    for (const s of listOrMap) {
      if (s && s.id && s.url) {
        idToUrl.set(s.id, s.url);
        defaultIds.push(s.id);
      }
    }
  } else if (listOrMap && typeof listOrMap === "object") {
    for (const [id, url] of Object.entries(listOrMap)) {
      idToUrl.set(id, url);
      defaultIds.push(id);
    }
  }

  // Reset caches for new set (keeps already-decoded buffers for identical URLs)
  rrIndex = 0;
  padToId.clear();
}

// ---------- Internals ----------

async function loadSoundMap() {
  idToUrl.clear();
  defaultIds = [];

  // Try /sounds.json first
  try {
    const res = await fetch("/sounds.json", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        for (const s of data) {
          if (s?.id && s?.url) {
            idToUrl.set(s.id, s.url);
            defaultIds.push(s.id);
          }
        }
      } else if (data && typeof data === "object") {
        for (const [id, url] of Object.entries(data)) {
          idToUrl.set(id, url);
          defaultIds.push(id);
        }
      }
    }
  } catch {
    // ignore; will fall back to defaults
  }

  // Fallback to the 9 defaults if nothing was loaded
  if (idToUrl.size === 0) {
    for (const s of DEFAULT_SOUNDS) {
      idToUrl.set(s.id, s.url);
      defaultIds.push(s.id);
    }
  }
}

async function preloadAll() {
  // Warm the cache so first hit is tight
  const urls = [...idToUrl.values()];
  await Promise.all(urls.map((u) => getBuffer(u).catch(() => null)));
}

async function getBuffer(url) {
  if (cache.has(url)) return cache.get(url);
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) return null;
  const arr = await res.arrayBuffer();
  const buf = await getCtx().decodeAudioData(arr.slice(0));
  cache.set(url, buf);
  return buf;
}

function getCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: "interactive",
    });
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  return ctx;
}

function resolveSoundForPad(copyId) {
  if (padToId.has(copyId)) return padToId.get(copyId);

  // Stable round-robin assignment on first touch
  if (defaultIds.length === 0) {
    for (const s of DEFAULT_SOUNDS) idToUrl.set(s.id, s.url);
    defaultIds = DEFAULT_SOUNDS.map((s) => s.id);
  }
  const picked = defaultIds[rrIndex % defaultIds.length];
  rrIndex++;
  padToId.set(copyId, picked);
  return picked;
}
