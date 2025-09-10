// /src/app.js
// DJ Drum Kit — screen-state controller + detection + motion-trigger play

/************ DOM REFS ************/
const $ = (id) => document.getElementById(id);
const ui = {
  // screens
  onboard: $("onboard"),
  main: $("mainScreen"),
  labeling: $("labelingScreen"),
  play: $("playScreen"),
  call: $("callScreen"),
  // main elements
  year: $("year"),
  diag: $("diag"),
  // onboarding
  btnGrant: $("btnGrant"),
  btnWhy: $("btnWhy"),
  btnDismiss: $("btnDismiss"),
  // main
  camera: $("camera"),
  btnCapture: $("btnCapture"),
  // labeling
  detectedGrid: $("detectedGrid"),
  btnContinueToPlay: $("btnContinueToPlay"),
  // play
  cameraLive: $("cameraLive"),
  dupeArea: $("dupeArea"),
  btnRecordLoop: $("btnRecordLoop"),
  btnAddLoop: $("btnAddLoop"),
  btnRecordMedia: $("btnRecordMedia"),
  btnCall: $("btnCall"),
  // call
  cameraCall: $("cameraCall"),
  remoteVideo: $("remoteVideo"),
  btnCallNow: $("btnCallNow"),
  btnAnswer: $("btnAnswer"),
  btnHangup: $("btnHangup"),
};

ui.year.textContent = new Date().getFullYear();

/************ APP STATE ************/
const state = {
  streams: { cam: null, cam2: null, camCall: null },
  model: null,                 // COCO-SSD model
  audio: null,                 // AudioContext
  masterOut: null,             // GainNode
  sounds: {},                  // name -> AudioBuffer
  labels: new Map(),           // detectedId -> soundName
  detections: [],              // {id, bbox, class, score}
  duplicates: [],              // {id, el, soundName, cooldownUntil}
  loops: [],                   // [{hits:[{time, soundName}], lengthMs}]
  mediaRecorder: null,
  recChunks: [],
  frameWorker: null,           // Offscreen frame-diff (optional upgrade)
};

/************ UTIL: screen switching ************/
function showOnly(el) {
  [ui.onboard, ui.main, ui.labeling, ui.play, ui.call].forEach((s) => {
    s.classList.toggle("hidden", s !== el);
  });
}

/************ AUDIO: bootstrap + load sounds ************/
async function ensureAudio() {
  if (!state.audio) {
    state.audio = new (window.AudioContext || window.webkitAudioContext)();
    state.masterOut = state.audio.createGain();
    state.masterOut.connect(state.audio.destination);
  }
}
async function loadSound(name, url) {
  if (state.sounds[name]) return state.sounds[name];
  const res = await fetch(url);
  const arr = await res.arrayBuffer();
  const buf = await state.audio.decodeAudioData(arr);
  state.sounds[name] = buf;
  return buf;
}
// Pick your 9 labels (names must match files you provide)
const NINE_SOUNDS = [
  "kick", "snare", "hh-closed", "hh-open",
  "rim", "clap", "tom-low", "tom-mid", "tom-high"
];

/************ CAMERA HELPERS ************/
async function getCamStream(constraints = { video: { facingMode: "environment" }, audio: true }) {
  return await navigator.mediaDevices.getUserMedia(constraints);
}
function attachStream(videoEl, stream) {
  videoEl.srcObject = stream;
  return new Promise((r) => (videoEl.onloadedmetadata = () => { videoEl.play(); r(); }));
}

/************ MODEL ************/
async function ensureModel() {
  if (!state.model) {
    // cocoSsd is global courtesy of your <script> in index.html
    state.model = await cocoSsd.load({ base: "lite_mobilenet_v2" });
  }
}

/************ ONBOARDING ************/
ui.btnWhy.addEventListener("click", () => {
  alert(
    "Camera: take a still for object detection & live motion triggers.\n" +
    "Microphone: capture loops and mixdown recordings.\n" +
    "Nothing leaves your device unless you share a recording."
  );
});
ui.btnDismiss.addEventListener("click", () => {
  // Allow exploring (camera prompts will still appear later)
  ui.onboard.classList.add("hidden");
  showOnly(ui.main);
});

ui.btnGrant.addEventListener("click", async () => {
  try {
    await ensureAudio();
    // preload sounds (non-blocking fire-and-forget)
    NINE_SOUNDS.forEach((n) => loadSound(n, `/sounds/${n}.mp3`).catch(()=>{}));

    const stream = await getCamStream();
    state.streams.cam = stream;
    await attachStream(ui.camera, stream);

    await ensureModel();
    showOnly(ui.main);
  } catch (err) {
    console.error(err);
    alert("Permissions are required. Please allow camera & mic in your browser settings.");
  }
});

/************ SNAP → DETECT ************/
ui.btnCapture.addEventListener("click", async () => {
  if (!state.streams.cam) {
    try {
      state.streams.cam = await getCamStream();
      await attachStream(ui.camera, state.streams.cam);
    } catch (e) {
      return alert("Camera unavailable.");
    }
  }
  await ensureModel();

  // draw a still frame into canvas
  const canvas = document.createElement("canvas");
  const vw = ui.camera.videoWidth;
  const vh = ui.camera.videoHeight;
  canvas.width = vw; canvas.height = vh;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(ui.camera, 0, 0, vw, vh);

  // run detection on the still
  const imgBitmap = await createImageBitmap(canvas);
  const preds = await state.model.detect(imgBitmap, 10); // up to 10 objects

  // store detections with ids
  state.detections = preds.map((p, idx) => ({
    id: `det-${Date.now()}-${idx}`,
    bbox: p.bbox,        // [x, y, width, height]
    class: p.class,
    score: p.score,
  }));

  // build labeling UI
  ui.detectedGrid.innerHTML = "";
  state.labels.clear();
  state.detections.forEach((d) => {
    const item = document.createElement("div");
    item.className = "label-item";
    item.innerHTML = `
      <div class="det-name">${d.class} <span class="muted">(${(d.score*100|0)}%)</span></div>
      <label>Select drum</label>
      <select data-id="${d.id}">
        ${NINE_SOUNDS.map((n)=>`<option value="${n}">${n}</option>`).join("")}
      </select>
    `;
    ui.detectedGrid.appendChild(item);
  });

  showOnly(ui.labeling);
});

/************ CONTINUE → PLAY ************/
ui.btnContinueToPlay.addEventListener("click", async () => {
  // read selected labels
  [...ui.detectedGrid.querySelectorAll("select")].forEach((sel) => {
    state.labels.set(sel.dataset.id, sel.value);
  });

  // start a fresh live stream (separate <video> to keep screens independent)
  if (!state.streams.cam2) {
    state.streams.cam2 = await getCamStream({ video: { facingMode: "environment" }, audio: false });
  }
  await attachStream(ui.cameraLive, state.streams.cam2);

  // create one duplicate per detection
  ui.dupeArea.innerHTML = "";
  state.duplicates = state.detections.map((d) => {
    const el = document.createElement("div");
    el.className = "dupe";
    el.textContent = state.labels.get(d.id) || "pad";
    el.draggable = true;
    el.style.left = Math.max(12, d.bbox[0] / 4) + "px";  // initial scatter
    el.style.top  = Math.max(12, d.bbox[1] / 4) + "px";
    el.dataset.sound = state.labels.get(d.id) || NINE_SOUNDS[0];

    dragEnable(el, ui.dupeArea);
    ui.dupeArea.appendChild(el);

    return { id: d.id, el, soundName: el.dataset.sound, cooldownUntil: 0 };
  });

  // kick off motion detection loop
  startMotionLoop();

  showOnly(ui.play);
});

/************ DRAGGING (screen-space only) ************/
function dragEnable(el, container) {
  let startX, startY, origX, origY;
  el.addEventListener("dragstart", (e) => {
    startX = e.clientX; startY = e.clientY;
    const rect = el.getBoundingClientRect();
    const crect = container.getBoundingClientRect();
    origX = rect.left - crect.left; origY = rect.top - crect.top;
    e.dataTransfer.setData("text/plain", "x"); // required on some browsers
  });
  container.addEventListener("dragover", (e) => e.preventDefault());
  container.addEventListener("drop", (e) => {
    e.preventDefault();
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    el.style.left = Math.max(0, origX + dx) + "px";
    el.style.top  = Math.max(0, origY + dy) + "px";
  });
}

/************ MOTION LOOP (frame-diff per duplicate) ************/
let motionRAF = null;
const diffCanvas = document.createElement("canvas");
const diffCtx = diffCanvas.getContext("2d");
let lastFrame = null;

function startMotionLoop() {
  const v = ui.cameraLive;
  diffCanvas.width = v.videoWidth || 640;
  diffCanvas.height = v.videoHeight || 480;

  cancelAnimationFrame(motionRAF);
  const tick = () => {
    // draw current frame
    diffCtx.drawImage(v, 0, 0, diffCanvas.width, diffCanvas.height);
    const curr = diffCtx.getImageData(0, 0, diffCanvas.width, diffCanvas.height);

    if (lastFrame) {
      // check motion per duplicate AoI (area of interest)
      state.duplicates.forEach((dup) => {
        const rect = dup.el.getBoundingClientRect();
        const base = ui.dupeArea.getBoundingClientRect();
        // map UI space to video pixels
        const x = Math.floor(((rect.left - base.left) / base.width) * diffCanvas.width);
        const y = Math.floor(((rect.top  - base.top ) / base.height) * diffCanvas.height);
        const w = Math.max(20, Math.floor((rect.width / base.width) * diffCanvas.width));
        const h = Math.max(20, Math.floor((rect.height/ base.height)* diffCanvas.height));
        const changed = regionDiffPercent(lastFrame, curr, x, y, w, h);

        // trigger when change exceeds threshold (and cooldown elapsed)
        const now = performance.now();
        const THRESH = 0.12;    // ~12% pixels changed
        const COOLDOWN_MS = 180; // anti-reverb
        if (changed > THRESH && now > dup.cooldownUntil) {
          playSound(dup.soundName, 0.9);
          dup.cooldownUntil = now + COOLDOWN_MS;
          pulse(dup.el);
          log(`hit:${dup.soundName} diff=${(changed*100).toFixed(1)}%`);
        }
      });
    }
    lastFrame = curr;
    motionRAF = requestAnimationFrame(tick);
  };
  motionRAF = requestAnimationFrame(tick);
}

function regionDiffPercent(prev, curr, x, y, w, h) {
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  x = clamp(x, 0, curr.width-1);
  y = clamp(y, 0, curr.height-1);
  w = clamp(w, 1, curr.width - x);
  h = clamp(h, 1, curr.height - y);

  let changed = 0;
  const stride = curr.width * 4;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const idx = ((y + j) * stride) + ((x + i) * 4);
      // simple luminance diff
      const r1 = prev.data[idx], g1 = prev.data[idx+1], b1 = prev.data[idx+2];
      const r2 = curr.data[idx], g2 = curr.data[idx+1], b2 = curr.data[idx+2];
      const l1 = 0.299*r1 + 0.587*g1 + 0.114*b1;
      const l2 = 0.299*r2 + 0.587*g2 + 0.114*b2;
      if (Math.abs(l2 - l1) > 28) changed++;
    }
  }
  return changed / (w * h);
}

/************ PLAY SOUND ************/
async function playSound(name, gain=1) {
  await ensureAudio();
  const buf = await loadSound(name, `/sounds/${name}.mp3`);
  const src = state.audio.createBufferSource();
  src.buffer = buf;
  const g = state.audio.createGain();
  g.gain.value = gain;
  src.connect(g).connect(state.masterOut);
  src.start();
}

/************ UI FX + Logging ************/
function pulse(el) {
  el.animate([{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }], { duration: 120 });
}
function log(msg) {
  ui.diag.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
}

/************ LOOPS (timestamp-based) ************/
let activeLoop = { hits: [], lengthMs: 4000, playingTimer: null };
ui.btnRecordLoop.addEventListener("click", () => {
  if (!activeLoop.recording) {
    activeLoop = { hits: [], lengthMs: activeLoop.lengthMs, playingTimer: null, recording: true, t0: performance.now() };
    log("loop: recording… tap pads (move hands) to capture");
    // intercept playSound to capture hits while recording
    const original = playSound;
    playSound = async (name, gain=1) => {
      const t = performance.now() - activeLoop.t0;
      activeLoop.hits.push({ time: t % activeLoop.lengthMs, soundName: name });
      await original(name, gain);
    };
    ui.btnRecordLoop.textContent = "■ Stop Loop";
  } else {
    // stop recording and normalize
    activeLoop.recording = false;
    ui.btnRecordLoop.textContent = "● Record Loop";
    // restore playSound
    delete window.__dummy;
    // schedule playback
    if (activeLoop.playingTimer) clearInterval(activeLoop.playingTimer);
    activeLoop.playingTimer = setInterval(() => {
      const start = performance.now();
      activeLoop.hits.forEach(({ time, soundName }) => {
        setTimeout(() => playSound(soundName, 0.9), time);
      });
    }, activeLoop.lengthMs);
    log(`loop: captured ${activeLoop.hits.length} hits over ${activeLoop.lengthMs}ms`);
  }
});
ui.btnAddLoop.addEventListener("click", () => {
  // simple length toggle for now (4s -> 8s -> 2s)
  const next = activeLoop.lengthMs === 4000 ? 8000 : activeLoop.lengthMs === 8000 ? 2000 : 4000;
  activeLoop.lengthMs = next;
  log(`loop length set to ${next}ms`);
});

/************ MEDIA RECORD ************/
ui.btnRecordMedia.addEventListener("click", async () => {
  try {
    await ensureAudio();
    // Mix WebAudio + camera video
    const vStream = ui.cameraLive.captureStream();
    const dest = state.audio.createMediaStreamDestination();
    state.masterOut.disconnect();
    state.masterOut.connect(dest);
    state.masterOut.connect(state.audio.destination);
    const mixed = new MediaStream([...vStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    state.recChunks = [];
    const mr = new MediaRecorder(mixed, { mimeType: "video/webm;codecs=vp8,opus" });
    state.mediaRecorder = mr;
    mr.ondataavailable = (e) => e.data.size && state.recChunks.push(e.data);
    mr.onstop = async () => {
      const blob = new Blob(state.recChunks, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `dj-drumkit-${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
      log("recording saved");
    };
    mr.start();
    log("media recording… press again to stop");
    ui.btnRecordMedia.textContent = "■ Stop Media";
    ui.btnRecordMedia.onclick = () => {
      mr.stop();
      ui.btnRecordMedia.textContent = "⏺ Record Media";
      // rebind original handler
      ui.btnRecordMedia.onclick = arguments.callee.__orig || (()=>{});
    };
    // keep original for rebind
    ui.btnRecordMedia.onclick.__orig = ui.btnRecordMedia.onclick;
  } catch (e) {
    console.error(e);
    alert("Recording not supported in this browser.");
  }
});

/************ CALL UI (stubs that keep the screen working) ************/
ui.btnCall.addEventListener("click", async () => {
  // start local preview and show call screen
  try {
    if (!state.streams.camCall) {
      state.streams.camCall = await getCamStream({ video: true, audio: true });
    }
    await attachStream(ui.cameraCall, state.streams.camCall);
    showOnly(ui.call);
  } catch (e) {
    alert("Camera/mic needed for calling.");
  }
});

ui.btnCallNow.addEventListener("click", () => {
  // TODO: Implement WebRTC offer via signaling server (no room ID in UI)
  alert("TODO: Start call — requires signaling (WebSocket/Supabase Realtime). UI is ready.");
});
ui.btnAnswer.addEventListener("click", () => {
  // TODO: Implement answer path
  alert("TODO: Answer call — wire to signaling payload.");
});
ui.btnHangup.addEventListener("click", () => {
  if (ui.remoteVideo.srcObject) ui.remoteVideo.srcObject.getTracks().forEach(t=>t.stop());
  showOnly(ui.play);
});

/************ START: show onboarding initially ************/
showOnly(ui.onboard);
log("ready");
