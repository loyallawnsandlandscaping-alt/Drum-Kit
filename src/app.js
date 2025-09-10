// ===== src/app.js (detect/undetect overlay + snapshot persistence) =====

import {
  initPads,
  enablePlacing,
  onCollision,
  setCooldown,
  setSensitivity,
  replaceCopiesFromDetections,
  setMirror,
} from "./pads/scene.js";

import { RecorderEnhance } from "./lib/recorder.js";
import * as Audio from "./audioEngine.js";

import {
  startCamera,
  takeSnapshot,
  listDevices,
  switchCamera,
  startScreenMirror,
  detectOnCanvas,
} from "./media.js";

import * as RTC from "./call.js";
import { startBattle, stopBattle, registerLocalHit } from "./battle.js";

// ---------- DOM ----------
const videoEl = document.getElementById("camera");
const overlay = document.getElementById("frame");
const detectOverlay = document.getElementById("detect");

const cameraSelect = document.getElementById("cameraSelect");
const btnSwitchCam = document.getElementById("btnSwitchCam");
const btnMirror = document.getElementById("btnMirror");

const btnStart = document.getElementById("btnStart");
const btnCapture = document.getElementById("btnCapture");
const btnDetect = document.getElementById("btnDetect");
const btnUndetect = document.getElementById("btnUndetect");

const btnRecord = document.getElementById("btnRecord");
const btnStopRec = document.getElementById("btnStopRec");
const btnPlayLoop = document.getElementById("btnPlayLoop");
const btnStopLoop = document.getElementById("btnStopLoop");

const cooldown = document.getElementById("cooldown");
const motionThresh = document.getElementById("motionThresh");
const loopLen = document.getElementById("loopLen");

const room = document.getElementById("roomId");
const callBtn = document.getElementById("btnCall");
const answerBtn = document.getElementById("btnAnswer");
const hangBtn = document.getElementById("btnHangup");
const callStatus = document.getElementById("callStatus");

const btnInstall = document.getElementById("btnInstall");
const btnReset = document.getElementById("btnReset");

const btnGrant = document.getElementById("btnGrant");
const btnDismiss = document.getElementById("btnDismiss");

const yearEl = document.getElementById("year");
const detectedList = document.getElementById("detectedList");
const snapshotPreview = document.getElementById("snapshotPreview");

// ---------- State for snapshot & detections ----------
let lastSnap = /** @type {{blob:Blob,url:string,canvas:HTMLCanvasElement}|null} */(null);
let lastDetections = /** @type {Array<{label:string,score:number,bbox:number[]}>} */([]);
let isMirrored = true; // default to front camera view

// ---------- Init pads overlay ----------
initPads(videoEl, overlay);
setMirror(isMirrored);

// ---------- Helpers ----------
function sizeOverlayToVideo() {
  const rect = videoEl.getBoundingClientRect();
  [overlay, detectOverlay].forEach(c => {
    if (!c) return;
    c.width = rect.width;
    c.height = rect.height;
    c.style.width = rect.width + "px";
    c.style.height = rect.height + "px";
    c.style.position = "absolute";
    c.style.left = 0; c.style.top = 0;
    c.style.pointerEvents = "none";
  });
}
new ResizeObserver(sizeOverlayToVideo).observe(videoEl);

function renderDetections(detections) {
  sizeOverlayToVideo();
  const ctx = detectOverlay.getContext("2d");
  ctx.clearRect(0,0,detectOverlay.width, detectOverlay.height);

  // scale snapshot bbox → current video CSS space
  const scaleX = detectOverlay.width / (videoEl.videoWidth || detectOverlay.width);
  const scaleY = detectOverlay.height / (videoEl.videoHeight || detectOverlay.height);

  ctx.lineWidth = 2;
  ctx.font = "12px ui-sans-serif, system-ui";

  detections.forEach((d) => {
    let [x,y,w,h] = d.bbox;
    // if preview is mirrored, flip X for overlay too
    if (isMirrored) {
      const snapW = videoEl.videoWidth || detectOverlay.width;
      const xRight = x + w;
      x = snapW - xRight;
    }
    const rx = x * scaleX, ry = y * scaleY, rw = w * scaleX, rh = h * scaleY;
    ctx.strokeStyle = "rgba(255,183,77,0.95)"; // warm burst
    ctx.fillStyle = "rgba(255,183,77,0.12)";
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.fillRect(rx, ry, rw, rh);
    ctx.fillStyle = "rgba(231,231,234,0.95)";
    ctx.fillText(`${d.label} ${(d.score*100|0)}%`, rx + 6, ry + 14);
  });
}

function clearDetections() {
  const ctx = detectOverlay.getContext("2d");
  ctx.clearRect(0,0,detectOverlay.width, detectOverlay.height);
  detectedList.innerHTML = "";
}

function renderDetectedList(detections) {
  detectedList.innerHTML = "";
  detections.slice(0, 24).forEach((d, i) => {
    const div = document.createElement("div");
    div.className = "pill";
    div.textContent = `#${i+1} ${d.label} (${(d.score*100|0)}%)`;
    detectedList.appendChild(div);
  });
}

function showSnapshotPreview(url) {
  if (snapshotPreview) {
    snapshotPreview.src = url || "";
    snapshotPreview.style.display = url ? "block" : "none";
  }
}

// ---------- Camera ----------
btnStart?.addEventListener("click", async () => {
  try {
    await startCamera(videoEl, { video: { facingMode: "user" }, audio: false });
    isMirrored = true;
    setMirror(isMirrored);
    const s = document.getElementById("camStatus");
    if (s) s.textContent = "camera: live";
    await populateCameras();   // fill dropdown once permission granted
  } catch (err) {
    alert("Camera permission needed: " + (err?.message || err));
  }
});

async function populateCameras() {
  const devices = await listDevices();
  cameraSelect.innerHTML = "";
  for (const d of devices) {
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = d.label || "Camera";
    cameraSelect.appendChild(opt);
  }
}
cameraSelect?.addEventListener("change", async (e) => {
  const id = e.target.value;
  await switchCamera(videoEl, id);
  // deviceId doesn't tell us facing; keep current mirroring
  setMirror(isMirrored);
});
btnSwitchCam?.addEventListener("click", async () => {
  await switchCamera(videoEl);          // toggles front/back
  isMirrored = !isMirrored;             // flip mirror flag
  setMirror(isMirrored);                // keep pads active; just update mirror math
  // keep overlay sizes consistent
  sizeOverlayToVideo();
});

// ---------- Mirror (tab capture) ----------
btnMirror?.addEventListener("click", async () => {
  const stream = await startScreenMirror();
  if (!stream) return;
  const prev = document.createElement("video");
  prev.muted = true; prev.autoplay = true; prev.playsInline = true;
  prev.style.position = "fixed"; prev.style.bottom = "12px"; prev.style.right = "12px";
  prev.style.width = "200px"; prev.style.border = "1px solid rgba(255,255,255,0.2)";
  document.body.appendChild(prev);
  prev.srcObject = stream;
  stream.getVideoTracks()[0].addEventListener("ended", () => prev.remove());
});

// ---------- Capture (photo → detect → draw boxes → replace pads) ----------
btnCapture?.addEventListener("click", async () => {
  clearDetections();

  try {
    lastSnap = await takeSnapshot(videoEl); // arms audio too
    showSnapshotPreview(lastSnap.url);
  } catch (e) {
    // if snapshot fails, still allow pad placing
    lastSnap = null;
    showSnapshotPreview("");
  }

  if (lastSnap?.canvas) {
    try {
      lastDetections = await detectOnCanvas(lastSnap.canvas);
      renderDetections(lastDetections);
      renderDetectedList(lastDetections);

      // Make ONLY these objects relevant until next shot:
      replaceCopiesFromDetections(lastDetections, videoEl, { mirror: isMirrored });
    } catch (e) {
      // model not loaded or detection failed; keep going
      lastDetections = [];
    }
  }

  // Preserve UX: after photo/detection, enable placing pads manually if desired
  enablePlacing();
});

// ---------- Detect / Undetect overlay without changing pads ----------
btnDetect?.addEventListener("click", () => {
  if (lastDetections && lastDetections.length) {
    renderDetections(lastDetections);
    renderDetectedList(lastDetections);
  }
});

btnUndetect?.addEventListener("click", () => {
  // Hide detection overlay and list, but DO NOT touch pads
  clearDetections();
});

// ---------- Pad hit -> audio + recorder + battle ----------
onCollision((copyId) => {
  try { Audio.playPad(copyId); } catch {}
  try { RecorderEnhance.note(copyId); } catch {}
  try { registerLocalHit(copyId); } catch {}
});

// ---------- Recorder controls ----------
btnRecord?.addEventListener("click", () => {
  RecorderEnhance.start();
  if (btnRecord) btnRecord.disabled = true;
  if (btnStopRec) btnStopRec.disabled = false;
});
btnStopRec?.addEventListener("click", () => {
  RecorderEnhance.stop();
  if (btnRecord) btnRecord.disabled = false;
  if (btnStopRec) btnStopRec.disabled = true;
  if (btnPlayLoop) btnPlayLoop.disabled = false;
  if (btnStopLoop) btnStopLoop.disabled = false;
});
btnPlayLoop?.addEventListener("click", () => RecorderEnhance.playLoop());
btnStopLoop?.addEventListener("click", () => RecorderEnhance.stopLoop());

// Loop length slider
if (loopLen) {
  const v = parseInt(loopLen.value, 10);
  if (!Number.isNaN(v)) RecorderEnhance.setLoopSeconds(v);
  loopLen.addEventListener("input", () => {
    const n = parseInt(loopLen.value, 10);
    if (!Number.isNaN(n)) RecorderEnhance.setLoopSeconds(n);
  });
}

// ---------- Drummer sliders ----------
if (cooldown) {
  const v = parseInt(cooldown.value, 10);
  if (!Number.isNaN(v)) setCooldown(v);
  cooldown.addEventListener("input", () => {
    const n = parseInt(cooldown.value, 10);
    if (!Number.isNaN(n)) setCooldown(n);
  });
}
if (motionThresh) {
  const v = parseInt(motionThresh.value, 10);
  if (!Number.isNaN(v)) setSensitivity(v);
  motionThresh.addEventListener("input", () => {
    const n = parseInt(motionThresh.value, 10);
    if (!Number.isNaN(n)) setSensitivity(n);
  });
}

// ---------- Calls ----------
callBtn?.addEventListener("click", async () => {
  if (!room) return;
  const id = room.value?.trim();
  if (!id) return;
  callStatus && (callStatus.textContent = "calling…");
  await RTC.call(id);
  if (hangBtn) hangBtn.disabled = false;
});
answerBtn?.addEventListener("click", async () => {
  if (!room) return;
  const id = room.value?.trim();
  if (!id) return;
  callStatus && (callStatus.textContent = "answering…");
  await RTC.answer(id);
  if (hangBtn) hangBtn.disabled = false;
});
hangBtn?.addEventListener("click", async () => {
  await RTC.hangup();
  callStatus && (callStatus.textContent = "call: idle");
  if (hangBtn) hangBtn.disabled = true;
  try { stopBattle(); } catch {}
});

// ---------- PWA install ----------
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  const deferred = e;
  if (btnInstall) btnInstall.disabled = false;
  btnInstall?.addEventListener("click", () => deferred.prompt(), { once: true });
});

// ---------- Reset cache ----------
btnReset?.addEventListener("click", async () => {
  try {
    if ("caches" in window) {
      const names = await caches.keys();
      for (const n of names) await caches.delete(n);
    }
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
  } catch {}
  location.reload();
});

// ---------- Onboarding ----------
btnGrant?.addEventListener("click", () => {
  btnStart?.click();
  const ob = document.getElementById("onboard");
  ob && ob.classList.add("hidden");
});
btnDismiss?.addEventListener("click", () => {
  const ob = document.getElementById("onboard");
  ob && ob.classList.add("hidden");
});

// ---------- Footer year ----------
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

// ---------- Prewarm audio (light) ----------
Audio.initAudio().catch(()=>{});
window.addEventListener("pointerdown", () => Audio.ensureUnlocked(), { once: true });
