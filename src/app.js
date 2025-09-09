// ===== src/app.js (full, updated) =====

// Pads / motion scene
import {
  initPads,
  enablePlacing,
  onCollision,
  setCooldown,
  setSensitivity,
} from "./pads/scene.js";

// Recorder (looping)
import { RecorderEnhance } from "./lib/recorder.js";

// Audio engine (play sounds by pad/copy id)
import * as Audio from "./audioEngine.js";

// Calling + battle
import * as RTC from "./call.js";
import { startBattle, stopBattle, registerLocalHit } from "./battle.js";

// ---------- DOM ----------
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

// ---------- Init pads overlay ----------
initPads(videoEl, overlay);

// ---------- Camera ----------
btnStart?.addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    videoEl.srcObject = stream;
    const s = document.getElementById("camStatus");
    if (s) s.textContent = "camera: live";
  } catch (err) {
    alert("Camera permission needed: " + (err?.message || err));
  }
});

// Click to place a duplicate pad
btnCapture?.addEventListener("click", () => enablePlacing());

// If you have a “Duplicate All” action, you can wire it here (no-op placeholder)
// btnDuplicateAll?.addEventListener("click", () => { /* your existing logic */ });

// ---------- Pad hit -> audio + recorder + battle ----------
onCollision((copyId) => {
  // play sound
  try { Audio.playPad(copyId); } catch {}

  // capture into loop
  try { RecorderEnhance.note(copyId); } catch {}

  // BATTLE: count this hit if a battle is active
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

// ---------- Drummer sliders (cooldown, sensitivity) ----------
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

// ---------- Call / Answer / Hangup ----------
callBtn?.addEventListener("click", async () => {
  if (!room) return;
  const id = room.value?.trim();
  if (!id) return;
  callStatus && (callStatus.textContent = "calling…");
  await RTC.call(id);
  if (hangBtn) hangBtn.disabled = false;

  // Optional: auto-start a battle once call initiates (comment out if you don’t want this)
  // startBattle(60);
});

answerBtn?.addEventListener("click", async () => {
  if (!room) return;
  const id = room.value?.trim();
  if (!id) return;
  callStatus && (callStatus.textContent = "answering…");
  await RTC.answer(id);
  if (hangBtn) hangBtn.disabled = false;

  // Optional: auto-start battle on answer
  // startBattle(60);
});

hangBtn?.addEventListener("click", async () => {
  await RTC.hangup();
  callStatus && (callStatus.textContent = "call: idle");
  if (hangBtn) hangBtn.disabled = true;
  // stop battle when hanging up (safe even if not active)
  try { stopBattle(); } catch {}
});

// ---------- PWA install ----------
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  const deferred = e;
  if (btnInstall) btnInstall.disabled = false;
  btnInstall?.addEventListener("click", () => deferred.prompt(), { once: true });
});

// ---------- Reset cache (service worker + caches) ----------
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
