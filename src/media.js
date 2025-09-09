// src/media.js
// Unified media helpers: camera video + audio arming after snapshot

import * as Audio from "./audioEngine.js";

let currentStream = null;

/**
 * Start camera on the provided video element.
 * Returns the MediaStream or throws on error (permission, etc).
 */
export async function startCamera(videoEl, constraints = { video: { facingMode: "user" }, audio: false }) {
  stopCamera(); // ensure no dangling tracks
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  currentStream = stream;
  if (videoEl) {
    videoEl.srcObject = stream;
    await videoEl.play().catch(()=>{});
  }
  return stream;
}

/**
 * Stop the active camera stream (if any).
 */
export function stopCamera() {
  if (currentStream) {
    for (const t of currentStream.getTracks()) {
      try { t.stop(); } catch {}
    }
  }
  currentStream = null;
}

/**
 * Take a snapshot from a <video> into a Blob.
 * After capture, it arms the audio engine (init + unlock) so hits are tight.
 * Returns { blob, url } for convenience (revokeObjectURL when done).
 */
export async function takeSnapshot(videoEl, type = "image/png", quality) {
  if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight) {
    throw new Error("Video not ready for snapshot");
  }

  const cvs = document.createElement("canvas");
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  cvs.width = w; cvs.height = h;
  const ctx = cvs.getContext("2d");
  ctx.drawImage(videoEl, 0, 0, w, h);

  const blob = await new Promise((res) => cvs.toBlob(res, type, quality));
  const url = URL.createObjectURL(blob);

  // ARM AUDIO right after capture (perfect user gesture timing)
  try { await Audio.armAfterCapture(); } catch {}

  return { blob, url };
}

/**
 * Get available media devices for custom UIs (front/back cameras, etc).
 */
export async function listDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.map(d => ({ kind: d.kind, label: d.label, deviceId: d.deviceId, groupId: d.groupId }));
  } catch (e) {
    return [];
  }
}

/**
 * Utility: Replace camera with a specific deviceId (keeps audio:false).
 */
export async function switchCamera(videoEl, deviceId) {
  const constraints = { video: { deviceId: { exact: deviceId } }, audio: false };
  return startCamera(videoEl, constraints);
}
