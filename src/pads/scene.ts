// ======= pads/scene.ts (enhanced, drop-in) =======

type HitCb = (copyId: string) => void;

type Copy = {
  id: string;
  x: number; y: number; w: number; h: number; // CSS pixels over the video element
  lastHit: number;
  armed?: boolean;           // ADDED: hysteresis re-arm flag
  srcObjectId?: string;      // ADDED: for one-duplicate-per-object (optional)
};

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let localVideoEl: HTMLVideoElement;

let motionCanvas: HTMLCanvasElement;
let motionCtx: CanvasRenderingContext2D;

let copies: Copy[] = [];
let onHit: HitCb | null = null;
let placing = false;

// ---- drummer controls (runtime tunables) ----
let HIT_COOLDOWN_MS = 90;      // default tight
let MOTION_THRESH = 22;        // 0..255 edge activity to fire
let REARM_FACTOR = 0.60;       // re-arm when activity falls below 60% of threshold

/** Adjust tightness of hits; lower = faster, higher = safer */
export function setCooldown(ms: number) {
  HIT_COOLDOWN_MS = Math.max(20, Math.round(ms));
}

/** Sensitivity 1..20 (higher number = more sensitive / lower threshold) */
export function setSensitivity(level: number) {
  const lv = Math.min(20, Math.max(1, Math.round(level)));
  // Map 1..20 to a 28..14 threshold-ish range (tune to taste)
  MOTION_THRESH = Math.round(30 - lv * 0.8);  // 30→14
  // Re-arm factor scales slightly with sensitivity so very high sens re-arms quicker
  REARM_FACTOR = 0.55 + (lv * 0.01);          // ~0.56..0.75
}

/** Optional: global mapping so only duplicates play for a given detected object */
const objectToCopy = new Map<string, string>();
export function registerDuplicateForObject(detectedObjectId: string, copyId: string) {
  if (!objectToCopy.has(detectedObjectId)) objectToCopy.set(detectedObjectId, copyId);
  // tag copy so we can render/debug if desired
  const c = copies.find(c => c.id === copyId);
  if (c) c.srcObjectId = detectedObjectId;
}
export function unregisterDuplicateByCopy(copyId: string) {
  for (const [oid, cid] of objectToCopy.entries()) if (cid === copyId) objectToCopy.delete(oid);
}

// ---- public API you already had ----
export function initPads(videoEl: HTMLVideoElement, overlayCanvas: HTMLCanvasElement) {
  localVideoEl = videoEl;
  canvas = overlayCanvas;
  ctx = canvas.getContext('2d')!;
  motionCanvas = document.createElement('canvas');
  motionCtx = motionCanvas.getContext('2d')!;

  const resize = () => {
    const rect = localVideoEl.getBoundingClientRect();
    canvas.width = rect.width; canvas.height = rect.height;
    motionCanvas.width = Math.max(1, Math.floor(rect.width/2));
    motionCanvas.height = Math.max(1, Math.floor(rect.height/2));
    draw();
  };
  window.addEventListener('resize', resize);
  const ro = new ResizeObserver(resize); ro.observe(localVideoEl);
  resize();

  canvas.addEventListener('click', (e) => {
    if (!placing) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const id = `copy-${copies.length+1}`;
    const size = Math.round(Math.min(canvas.width, canvas.height) * 0.18);
    copies.push({ id, x: x - size/2, y: y - size/2, w: size, h: size, lastHit: 0, armed: true });
    placing = false;
    draw();
  });

  requestAnimationFrame(tick);
}

export function enablePlacing() { placing = true; }
export function onCollision(cb: HitCb) { onHit = cb; }
export function getCopyIds() { return copies.map(c => c.id); }

// ---- drawing (kept) ----
function draw() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  copies.forEach(c => {
    ctx.strokeStyle = "rgba(94,234,212,0.92)";
    ctx.lineWidth = 3;
    ctx.strokeRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = "rgba(94,234,212,0.08)";
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = "rgba(231,231,234,0.92)";
    ctx.font = "12px ui-sans-serif, system-ui";
    const label = c.srcObjectId ? `${c.id} · ${c.srcObjectId}` : c.id;
    ctx.fillText(label, c.x + 6, c.y + 14);
  });
}

// ---- frame-diff motion (kept) ----
let prevFrame: ImageData | null = null;

function tick() {
  if (localVideoEl.readyState >= 2) {
    motionCtx.drawImage(localVideoEl, 0,0, motionCanvas.width, motionCanvas.height);
    const frame = motionCtx.getImageData(0,0, motionCanvas.width, motionCanvas.height);

    if (prevFrame) {
      const diff = frameDiff(prevFrame, frame);
      checkCollisions(diff);
    }
    prevFrame = frame;
  }
  requestAnimationFrame(tick);
}

function frameDiff(a: ImageData, b: ImageData): Uint8ClampedArray {
  const out = new Uint8ClampedArray(a.width * a.height);
  for (let i=0, j=0; i<a.data.length; i+=4, j++) {
    const ag = (a.data[i] + a.data[i+1] + a.data[i+2]) / 3;
    const bg = (b.data[i] + b.data[i+1] + b.data[i+2]) / 3;
    out[j] = Math.abs(ag - bg);
  }
  return out;
}

// ---- edge-gated collisions with hysteresis & cooldown ----
function checkCollisions(diff: Uint8ClampedArray) {
  const now = performance.now();
  const W = motionCanvas.width, H = motionCanvas.height;

  for (const c of copies) {
    // Map copy rect from overlay canvas -> motion buffer
    const mx = Math.max(0, Math.floor(c.x / canvas.width * W));
    const my = Math.max(0, Math.floor(c.y / canvas.height * H));
    const mw = Math.max(1, Math.floor(c.w / canvas.width * W));
    const mh = Math.max(1, Math.floor(c.h / canvas.height * H));

    // Perimeter scan (outermost 1px approximate)
    let sum = 0, count = 0;
    for (let x=mx; x<mx+mw; x++){
      sum += diff[my*W + x]; count++;
      sum += diff[(my+mh-1)*W + x]; count++;
    }
    for (let y=my; y<my+mh; y++){
      sum += diff[y*W + mx]; count++;
      sum += diff[y*W + (mx+mw-1)]; count++;
    }
    const avg = sum / Math.max(1, count);

    // Hysteresis re-arm: only consider a new hit if armed,
    // and re-arm when activity drops below REARM_FACTOR * MOTION_THRESH
    const armed = c.armed !== false;
    const rearmThreshold = REARM_FACTOR * MOTION_THRESH;

    if (!armed) {
      if (avg < rearmThreshold) c.armed = true;
      continue;
    }

    // Cooldown + threshold
    if (avg > MOTION_THRESH && (now - c.lastHit) > HIT_COOLDOWN_MS) {
      c.lastHit = now;
      c.armed = false;

      // If using one-duplicate-per-object, enforce here (optional)
      if (c.srcObjectId) {
        const allowedCopy = objectToCopy.get(c.srcObjectId);
        if (allowedCopy && allowedCopy !== c.id) {
          // Not this copy’s turn; block
          continue;
        }
      }

      onHit?.(c.id);
    }
  }
}
