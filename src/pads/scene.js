// src/pads/scene.js
// Pads overlay, simple motion-edge hit detection, mirror handling, and detection -> pads mapping.

let canvas, ctx, motionCanvas, motionCtx, videoEl;
let copies = []; // {id, x,y,w,h, lastHit}
let onHitCb = null;
let placing = false;

let mirrored = true;        // visual mirror flag (user-facing)
let cooldownMs = 90;        // drummer-tuned
let sensitivity = 22;       // 0..255 average absdiff threshold

export function initPads(video, overlayCanvas) {
  videoEl = video;
  canvas = overlayCanvas;
  ctx = canvas.getContext("2d");

  motionCanvas = document.createElement("canvas");
  motionCtx = motionCanvas.getContext("2d");

  const resize = () => {
    const r = videoEl.getBoundingClientRect();
    canvas.width = r.width; canvas.height = r.height;
    motionCanvas.width = Math.max(1, Math.floor(r.width / 2));
    motionCanvas.height = Math.max(1, Math.floor(r.height / 2));
    draw();
  };
  window.addEventListener("resize", resize);
  const ro = new ResizeObserver(resize); ro.observe(videoEl);
  resize();

  canvas.addEventListener("click", (e) => {
    if (!placing) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const size = Math.round(Math.min(canvas.width, canvas.height) * 0.18);
    const id = `copy-${copies.length + 1}`;
    copies.push({ id, x: x - size / 2, y: y - size / 2, w: size, h: size, lastHit: 0 });
    placing = false;
    draw();
  });

  requestAnimationFrame(tick);
}

export function enablePlacing() { placing = true; }
export function onCollision(cb) { onHitCb = cb; }
export function setCooldown(ms) { cooldownMs = Math.max(10, +ms || cooldownMs); }
export function setSensitivity(val) { sensitivity = Math.max(1, +val || sensitivity); }
export function setMirror(flag) { mirrored = !!flag; draw(); }

export function replaceCopiesFromDetections(detections, vidEl, { mirror = true } = {}) {
  // Map detection boxes (in video pixels) -> overlay canvas coords
  const vw = vidEl.videoWidth || canvas.width;
  const vh = vidEl.videoHeight || canvas.height;
  const sx = canvas.width / vw;
  const sy = canvas.height / vh;

  copies = detections.slice(0, 9).map((d, i) => {
    let [x, y, w, h] = d.bbox;
    if (mirror) {
      const xRight = x + w;
      x = vw - xRight; // mirror horizontally
    }
    return {
      id: `copy-${i + 1}`,
      x: Math.max(0, x * sx),
      y: Math.max(0, y * sy),
      w: Math.max(12, w * sx),
      h: Math.max(12, h * sy),
      lastHit: 0,
    };
  });
  draw();
}

/* ------------ draw overlay boxes ------------ */
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  copies.forEach(c => {
    ctx.strokeStyle = "rgba(94,234,212,0.95)";
    ctx.lineWidth = 3;
    ctx.strokeRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = "rgba(94,234,212,0.10)";
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = "rgba(231,231,234,0.95)";
    ctx.font = "12px ui-sans-serif, system-ui";
    ctx.fillText(c.id, c.x + 6, c.y + 14);
  });
}

/* ------------ motion-edge collision ------------ */
let prevFrame = null;

function tick() {
  if (videoEl?.readyState >= 2) {
    motionCtx.drawImage(videoEl, 0, 0, motionCanvas.width, motionCanvas.height);
    const frame = motionCtx.getImageData(0, 0, motionCanvas.width, motionCanvas.height);
    if (prevFrame) {
      const diff = frameDiff(prevFrame, frame);
      checkCollisions(diff);
    }
    prevFrame = frame;
  }
  requestAnimationFrame(tick);
}

function frameDiff(a, b) {
  const out = new Uint8ClampedArray(a.width * a.height);
  for (let i = 0, j = 0; i < a.data.length; i += 4, j++) {
    const ag = (a.data[i] + a.data[i + 1] + a.data[i + 2]) / 3;
    const bg = (b.data[i] + b.data[i + 1] + b.data[i + 2]) / 3;
    out[j] = Math.abs(ag - bg);
  }
  return out;
}

function checkCollisions(diff) {
  const now = performance.now();
  const W = motionCanvas.width, H = motionCanvas.height;

  copies.forEach(c => {
    // map copy rect canvas -> motion buffer
    const mx = Math.max(0, Math.floor((c.x / canvas.width) * W));
    const my = Math.max(0, Math.floor((c.y / canvas.height) * H));
    const mw = Math.max(1, Math.floor((c.w / canvas.width) * W));
    const mh = Math.max(1, Math.floor((c.h / canvas.height) * H));

    let sum = 0, count = 0;
    // top & bottom
    for (let x = mx; x < mx + mw; x++) {
      sum += diff[my * W + x]; count++;
      sum += diff[(my + mh - 1) * W + x]; count++;
    }
    // left & right
    for (let y = my; y < my + mh; y++) {
      sum += diff[y * W + mx]; count++;
      sum += diff[y * W + (mx + mw - 1)]; count++;
    }
    const avg = sum / Math.max(1, count);

    if (avg > sensitivity && (now - c.lastHit) > cooldownMs) {
      c.lastHit = now;
      onHitCb && onHitCb(c.id);
    }
  });
}
