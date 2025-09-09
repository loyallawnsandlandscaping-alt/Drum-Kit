// ===== src/app.js =====
import { initPads, enablePlacing, onCollision, setCooldown, setSensitivity } from "./pads/scene.js";
import { RecorderEnhance } from "./lib/recorder.js";
import * as Audio from "./audioEngine.js";
import * as RTC from "./call.js";
import * as Battle from "./battle.js";

// --- DOM elements ---
const videoEl = document.getElementById("camera");
const overlay = document.getElementById("frame");

const btnStart = document.getElementById("btnStart");
const btnCapture = document.getElementById("btnCapture");
const btnDuplicateAll = document.getElementById("btnDuplicateAll");

const btnRecord = document.getElementById("btnRecord");
const btnStopRec = document.getElementById("btnStopRec");
const btnPlayLoop = document.getElementById("btnPlayLoop");
const btnStopLoop = document.getElementById("btnStopLoop");

const cooldown = document.getElementById("cooldown");
const motionThresh = document.getElementById("motionThresh");
const loopLen = document.getElementById("loopLen");

// --- Init pads overlay ---
initPads(videoEl, overlay);

// --- Camera start ---
btnStart.addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    videoEl.srcObject = stream;
    document.getElementById("camStatus").textContent = "camera: live";
  } catch (err) {
    alert("Camera permission needed: " + err.message);
  }
});

// --- Place pads by clicking ---
btnCapture.addEventListener("click", () => enablePlacing());

// --- Pad hits trigger sound & recorder note ---
onCollision((copyId) => {
  Audio.playPad(copyId);
  RecorderEnhance.note(copyId);
});

// --- Recorder UI ---
btnRecord.addEventListener("click", () => {
  RecorderEnhance.start();
  btnRecord.disabled = true;
  btnStopRec.disabled = false;
});
btnStopRec.addEventListener("click", () => {
  RecorderEnhance.stop();
  btnRecord.disabled = false;
  btnStopRec.disabled = true;
  btnPlayLoop.disabled = false;
  btnStopLoop.disabled = false;
});
btnPlayLoop.addEventListener("click", () => RecorderEnhance.playLoop());
btnStopLoop.addEventListener("click", () => RecorderEnhance.stopLoop());

// --- Sliders ---
if (cooldown) {
  setCooldown(parseInt(cooldown.value, 10));
  cooldown.addEventListener("input", () => setCooldown(parseInt(cooldown.value, 10)));
}
if (motionThresh) {
  setSensitivity(parseInt(motionThresh.value, 10));
  motionThresh.addEventListener("input", () => setSensitivity(parseInt(motionThresh.value, 10)));
}
if (loopLen) {
  RecorderEnhance.setLoopSeconds(parseInt(loopLen.value, 10));
  loopLen.addEventListener("input", () => RecorderEnhance.setLoopSeconds(parseInt(loopLen.value, 10)));
}

// --- Call / Battle glue ---
const room = document.getElementById("roomId");
const callBtn = document.getElementById("btnCall");
const answerBtn = document.getElementById("btnAnswer");
const hangBtn = document.getElementById("btnHangup");
const callStatus = document.getElementById("callStatus");

callBtn.addEventListener("click", async () => {
  callStatus.textContent = "calling…";
  await RTC.call(room.value);
  hangBtn.disabled = false;
});
answerBtn.addEventListener("click", async () => {
  callStatus.textContent = "answering…";
  await RTC.answer(room.value);
  hangBtn.disabled = false;
});
hangBtn.addEventListener("click", async () => {
  await RTC.hangup();
  callStatus.textContent = "call: idle";
  hangBtn.disabled = true;
});

// --- Install prompt (PWA) ---
const btnInstall = document.getElementById("btnInstall");
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  let deferred = e;
  btnInstall.disabled = false;
  btnInstall.addEventListener("click", () => deferred.prompt());
});

// --- Reset cache (clear SW + storage) ---
document.getElementById("btnReset").addEventListener("click", async () => {
  if (caches) {
    const names = await caches.keys();
    for (const n of names) await caches.delete(n);
  }
  location.reload();
});

// --- Onboarding ---
document.getElementById("btnGrant").addEventListener("click", () => {
  btnStart.click();
  document.getElementById("onboard").classList.add("hidden");
});
document.getElementById("btnDismiss").addEventListener("click", () => {
  document.getElementById("onboard").classList.add("hidden");
});

// --- Footer year ---
document.getElementById("year").textContent = new Date().getFullYear();
