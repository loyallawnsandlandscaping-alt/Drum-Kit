// src/app.js

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

// DOM
const videoEl = document.getElementById("camera");
const overlay = document.getElementById("frame");
const detectOverlay = document.getElementById("detect");

const btnStart = document.getElementById("btnStart");
const btnCapture = document.getElementById("btnCapture");
const btnDetect = document.getElementById("btnDetect");
const btnUndetect = document.getElementById("btnUndetect");
const btnReapplyPads = document.getElementById("btnReapplyPads");

const cameraSelect = document.getElementById("cameraSelect");
const btnSwitchCam = document.getElementById("btnSwitchCam");
const btnMirror = document.getElementById("btnMirror");

const callBtn = document.getElementById("btnCall");
const answerBtn = document.getElementById("btnAnswer");
const hangBtn = document.getElementById("btnHangup");
const room = document.getElementById("roomId");
const callStatus = document.getElementById("callStatus");

const cooldown = document.getElementById("cooldown");
const motionThresh = document.getElementById("motionThresh");
const loopLen = document.getElementById("loopLen");
const btnRecord = document.getElementById("btnRecord");
const btnStopRec = document.getElementById("btnStopRec");
const btnPlayLoop = document.getElementById("btnPlayLoop");
const btnStopLoop = document.getElementById("btnStopLoop");

const detectedList = document.getElementById("detectedList");
const snapshotPreview = document.getElementById("snapshotPreview");

const btnInstall = document.getElementById("btnInstall");
const btnReset = document.getElementById("btnReset");
const btnGrant = document.getElementById("btnGrant");
const btnDismiss = document.getElementById("btnDismiss");
const yearEl = document.getElementById("year");

// state
let lastDetections = [];
let isMirrored = true;

// init
initPads(videoEl, overlay);
Audio.initAudio().catch(()=>{});
window.addEventListener("pointerdown", () => Audio.ensureUnlocked(), { once: true });

// hits -> audio + recorder + battle
onCollision((copyId) => {
  try { Audio.playPad(copyId); } catch {}
  try { RecorderEnhance.note(copyId); } catch {}
  try { registerLocalHit(copyId); } catch {}
});

// camera start (front)
btnStart?.addEventListener("click", async () => {
  try {
    await startCamera(videoEl, { video: { facingMode: "user" }, audio: false });
    isMirrored = true;
    setMirror(true);
    const s = document.getElementById("camStatus");
    if (s) s.textContent = "camera: live";
    await populateCameras();
  } catch (e) {
    alert("Camera permission needed: " + (e?.message || e));
  }
});

async function populateCameras() {
  const devices = await listDevices();
  cameraSelect.innerHTML = "";
  devices.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = d.label || "Camera";
    cameraSelect.appendChild(opt);
  });
}

cameraSelect?.addEventListener("change", async (e) => {
  const id = e.target.value;
  await switchCamera(videoEl, id);
  setMirror(isMirrored);
});

btnSwitchCam?.addEventListener("click", async () => {
  await switchCamera(videoEl);         // toggles front/back stream
  isMirrored = !isMirrored;            // keep pad math correct
  setMirror(isMirrored);
});

// optional screen mirror
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

// snapshot -> detect -> replace pads
btnCapture?.addEventListener("click", async () => {
  clearDetections();
  let snap = null;
  try {
    snap = await takeSnapshot(videoEl); // arms audio too
    if (snapshotPreview) {
      snapshotPreview.src = snap.url;
      snapshotPreview.style.display = "block";
    }
  } catch {}

  if (snap?.canvas) {
    try {
      lastDetections = await detectOnCanvas(snap.canvas);
      renderDetections(lastDetections);
      renderDetectedList(lastDetections);
      replaceCopiesFromDetections(lastDetections, videoEl, { mirror: isMirrored });
    } catch { lastDetections = []; }
  }
  enablePlacing();
});

btnDetect?.addEventListener("click", () => {
  if (lastDetections.length) renderDetections(lastDetections);
});

btnUndetect?.addEventListener("click", clearDetections);

btnReapplyPads?.addEventListener("click", () => {
  if (!lastDetections.length) return;
  replaceCopiesFromDetections(lastDetections, videoEl, { mirror: isMirrored });
});

// recorder + loop
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

if (loopLen) {
  const v = +loopLen.value; if (!Number.isNaN(v)) RecorderEnhance.setLoopSeconds(v);
  loopLen.addEventListener("input", () => { const n = +loopLen.value; if (!Number.isNaN(n)) RecorderEnhance.setLoopSeconds(n); });
}
if (cooldown) {
  const v = +cooldown.value; if (!Number.isNaN(v)) setCooldown(v);
  cooldown.addEventListener("input", () => { const n = +cooldown.value; if (!Number.isNaN(n)) setCooldown(n); });
}
if (motionThresh) {
  const v = +motionThresh.value; if (!Number.isNaN(v)) setSensitivity(v);
  motionThresh.addEventListener("input", () => { const n = +motionThresh.value; if (!Number.isNaN(n)) setSensitivity(n); });
}

// calls (Supabase signaling)
callBtn?.addEventListener("click", async () => {
  const id = room.value?.trim();
  if (!id) return;
  if (callStatus) callStatus.textContent = "calling…";
  await RTC.call(id);
  if (hangBtn) hangBtn.disabled = false;
});
answerBtn?.addEventListener("click", async () => {
  const id = room.value?.trim();
  if (!id) return;
  if (callStatus) callStatus.textContent = "answering…";
  await RTC.answer(id);
  if (hangBtn) hangBtn.disabled = false;
});
hangBtn?.addEventListener("click", async () => {
  await RTC.hangup();
  if (callStatus) callStatus.textContent = "call: idle";
  if (hangBtn) hangBtn.disabled = true;
});

// detection overlay helpers
function renderDetections(detections) {
  const c = detectOverlay, ctx = c.getContext("2d");
  c.width = videoEl.clientWidth; c.height = videoEl.clientHeight;
  ctx.clearRect(0,0,c.width,c.height);
  const sx = c.width / (videoEl.videoWidth || c.width);
  const sy = c.height / (videoEl.videoHeight || c.height);
  ctx.lineWidth = 2; ctx.font = "12px ui-sans-serif, system-ui";
  detections.forEach(d => {
    let [x,y,w,h] = d.bbox;
    if (isMirrored) {
      const snapW = videoEl.videoWidth || c.width;
      const xRight = x + w;
      x = snapW - xRight;
    }
    const rx = x*sx, ry = y*sy, rw = w*sx, rh = h*sy;
    ctx.strokeStyle = "rgba(255,183,77,0.95)";
    ctx.fillStyle = "rgba(255,183,77,0.12)";
    ctx.strokeRect(rx, ry, rw, rh); ctx.fillRect(rx, ry, rw, rh);
    ctx.fillStyle = "rgba(231,231,234,0.95)";
    ctx.fillText(`${d.label} ${(d.score*100|0)}%`, rx+6, ry+14);
  });
}

function renderDetectedList(items) {
  detectedList.innerHTML = "";
  items.slice(0, 24).forEach((d,i) => {
    const div = document.createElement("div");
    div.className = "pill";
    div.textContent = `#${i+1} ${d.label} (${(d.score*100|0)}%)`;
    detectedList.appendChild(div);
  });
}

function clearDetections() {
  const c = detectOverlay, ctx = c.getContext("2d");
  ctx.clearRect(0,0,c.width,c.height);
  detectedList.innerHTML = "";
}

// PWA bits
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  const deferred = e;
  btnInstall?.addEventListener("click", () => deferred.prompt(), { once: true });
});

btnReset?.addEventListener("click", async () => {
  try {
    if ("caches" in window) for (const n of await caches.keys()) await caches.delete(n);
    if ("serviceWorker" in navigator) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  } catch {}
  location.reload();
});

btnGrant?.addEventListener("click", () => {
  btnStart?.click();
  const ob = document.getElementById("onboard");
  ob && ob.classList.add("hidden");
});
btnDismiss?.addEventListener("click", () => {
  const ob = document.getElementById("onboard");
  ob && ob.classList.add("hidden");
});

if (yearEl) yearEl.textContent = String(new Date().getFullYear());
