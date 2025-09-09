type HitCb = (copyId: string) => void;

type Copy = {
  id: string;
  x: number; y: number; w: number; h: number; // in CSS pixels over the video element
  lastHit: number;
};

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let localVideoEl: HTMLVideoElement;

let motionCanvas: HTMLCanvasElement;
let motionCtx: CanvasRenderingContext2D;

let copies: Copy[] = [];
let onHit: HitCb | null = null;
let placing = false;

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
    copies.push({ id, x: x - size/2, y: y - size/2, w: size, h: size, lastHit: 0 });
    placing = false;
    draw();
  });

  requestAnimationFrame(tick);
}

export function enablePlacing() { placing = true; }

export function onCollision(cb: HitCb) { onHit = cb; }

export function getCopyIds() { return copies.map(c => c.id); }

/* draw overlay boxes */
function draw() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  copies.forEach(c => {
    ctx.strokeStyle = "rgba(94,234,212,0.9)"; // accent
    ctx.lineWidth = 3;
    ctx.strokeRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = "rgba(94,234,212,0.08)";
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = "rgba(231,231,234,0.9)";
    ctx.font = "12px ui-sans-serif, system-ui";
    ctx.fillText(c.id, c.x + 6, c.y + 14);
  });
}

/* frame-difference motion detection */
let prevFrame: ImageData | null = null;

function tick() {
  if (localVideoEl.readyState >= 2) {
    // downscale sample for motion field
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

/* simple absdiff greyscale */
function frameDiff(a: ImageData, b: ImageData): Uint8ClampedArray {
  const out = new Uint8ClampedArray(a.width * a.height);
  for (let i=0, j=0; i<a.data.length; i+=4, j++) {
    const ag = (a.data[i] + a.data[i+1] + a.data[i+2]) / 3;
    const bg = (b.data[i] + b.data[i+1] + b.data[i+2]) / 3;
    out[j] = Math.abs(ag - bg);
  }
  return out;
}

/* test if motion crosses outer edge of any copy */
function checkCollisions(diff: Uint8ClampedArray) {
  const now = performance.now();
  const W = motionCanvas.width, H = motionCanvas.height;

  copies.forEach(c => {
    // map copy rect from overlay canvas -> motion buffer
    const mx = Math.max(0, Math.floor(c.x / canvas.width * W));
    const my = Math.max(0, Math.floor(c.y / canvas.height * H));
    const mw = Math.max(1, Math.floor(c.w / canvas.width * W));
    const mh = Math.max(1, Math.floor(c.h / canvas.height * H));

    // perimeter scan (outermost)
    let sum = 0, count = 0;
    // top & bottom rows
    for (let x=mx; x<mx+mw; x++){
      sum += diff[my*W + x]; count++;
      sum += diff[(my+mh-1)*W + x]; count++;
    }
    // left & right cols
    for (let y=my; y<my+mh; y++){
      sum += diff[y*W + mx]; count++;
      sum += diff[y*W + (mx+mw-1)]; count++;
    }
    const avg = sum / Math.max(1,count);

    // threshold tuned for drummer speed; tweak if needed
    const THRESH = 22; // 0..255
    const COOLDOWN_MS = 90;

    if (avg > THRESH && (now - c.lastHit) > COOLDOWN_MS) {
      c.lastHit = now;
      onHit?.(c.id);
    }
  });
}
