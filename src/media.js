// src/media.js
// Camera start/switch, snapshot, screen mirror, and on-canvas detection (lazy TF load)

let currentStream = null;
let currentDeviceId = null;
let facing = "user"; // "user" | "environment"

export async function startCamera(videoEl, constraints = {}) {
  await stopStream(currentStream);
  const base = {
    audio: false,
    video: constraints.video || { facingMode: facing },
  };
  currentStream = await navigator.mediaDevices.getUserMedia(base);
  videoEl.srcObject = currentStream;
  await videoEl.play();
  // remember active device (if available)
  const vtrack = currentStream.getVideoTracks()[0];
  const settings = vtrack.getSettings();
  currentDeviceId = settings.deviceId || null;
  return currentStream;
}

export async function listDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === "videoinput");
  } catch { return []; }
}

export async function switchCamera(videoEl, deviceId) {
  // toggle if no explicit deviceId provided
  if (!deviceId) facing = facing === "user" ? "environment" : "user";
  const cons = deviceId
    ? { video: { deviceId: { exact: deviceId } }, audio: false }
    : { video: { facingMode: facing }, audio: false };
  return startCamera(videoEl, cons);
}

export async function takeSnapshot(videoEl) {
  const canvas = document.createElement("canvas");
  const w = videoEl.videoWidth || videoEl.clientWidth || 640;
  const h = videoEl.videoHeight || videoEl.clientHeight || 480;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(videoEl, 0, 0, w, h);
  const url = canvas.toDataURL("image/png");
  return { canvas, url, w, h };
}

/* ---------------- Screen mirror ---------------- */
let displayStream = null;

/** Prompts the user to share a screen/window; returns the MediaStream or null. */
export async function startScreenMirror() {
  try {
    displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false,
    });
    return displayStream;
  } catch {
    return null;
  }
}

export async function stopScreenMirror() {
  await stopStream(displayStream);
  displayStream = null;
}

/* ---------------- TFJS object detection (lazy) ---------------- */
let tfLoaded = false;
let coco = null;

async function ensureModel() {
  if (tfLoaded && coco) return coco;
  // Lazy-load via ESM dynamic import (works in Vite)
  const tf = await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.14.0/dist/tf.min.js");
  const mod = await import(/* @vite-ignore */ "https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js");
  coco = await mod.load({ base: "lite_mobilenet_v2" });
  tfLoaded = true;
  return coco;
}

/** @param {HTMLCanvasElement} canvas -> returns [{bbox:[x,y,w,h], score, label}] */
export async function detectOnCanvas(canvas) {
  try {
    const model = await ensureModel();
    const preds = await model.detect(canvas, 25, 0.4);
    // normalize output
    return preds.map(p => ({
      bbox: p.bbox,        // [x, y, w, h]
      score: p.score || 0,
      label: p.class || p.label || "object",
    }));
  } catch {
    return [];
  }
}

/* ---------------- helpers ---------------- */
async function stopStream(stream) {
  try {
    if (!stream) return;
    stream.getTracks().forEach(t => t.stop());
  } catch {}
}
