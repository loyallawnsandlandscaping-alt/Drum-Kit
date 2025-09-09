import { loadAll, play } from "./audio";
import { Scene } from "./pads/scene";
import { crossesEdge } from "./pads/collide";

/** Map your uploaded sounds (in /public) */
const SAMPLE_MAP: Record<string, string> = {
  "kick-1": "/kick-1.wav",
  "deepkick": "/deepkick.wav",
  "snare-1": "/snare-1.wav",
  "clap-1": "/clap-1.wav",
  "clap-fat": "/clap-fat.wav",
  "openhat": "/openhat.wav",
  "closedhat-1": "/closedhat-1.wav",
  "tom-1": "/tom-1.wav",
  "tom-2": "/tom-2.wav"
};

// ---- DOM from index.html ----
const stage = document.getElementById("stage") as HTMLDivElement;
const detectBtn = document.getElementById("detectBtn") as HTMLButtonElement;
const recordBtn = document.getElementById("recordBtn") as HTMLButtonElement;
const stopBtn = document.getElementById("stopBtn") as HTMLButtonElement;

// Scene of draggable pads
const scene = new Scene(stage, () => scene.draw());

// --- Pointer → edge-cross collision ---
let lastPt: { x: number; y: number } | null = null;

function stagePos(e: PointerEvent) {
  const r = stage.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

stage.addEventListener("pointerdown", (e) => {
  const p = stagePos(e);
  lastPt = { ...p };
  const pad = scene["pointerDown"]?.(p.x, p.y);
  // click on a pad → preview
  if (pad) play(pad.sample);
});

stage.addEventListener("pointermove", (e) => {
  const p = stagePos(e);
  // drag behavior (move pads)
  scene["pointerMove"]?.(p.x, p.y);

  // edge-cross detection path: lastPt -> p
  if (lastPt) {
    const segPrev = lastPt;
    const segCurr = p;

    // fire all pads whose outer edge the segment crosses
    for (const pad of scene.pads) {
      const rect = { x: pad.x, y: pad.y, w: pad.w, h: pad.h };
      if (crossesEdge(segPrev, segCurr, rect)) {
        play(pad.sample); // multiple pads can fire in the same spot
      }
    }
  }
  lastPt = { ...p };
});

["pointerup", "pointerleave", "pointercancel"].forEach((ev) =>
  stage.addEventListener(ev, () => {
    scene["pointerUp"]?.();
    lastPt = null;
  })
);

// ---- Boot: load audio and drop starter pads you can drag/play ----
(async function boot() {
  try {
    await loadAll(SAMPLE_MAP);

    const W = stage.clientWidth || 960;
    const H = stage.clientHeight || 480;
    const pw = 140, ph = 120, gap = 12;

    // Pick 5 from your map for the initial layout
    const picks = ["kick-1", "snare-1", "clap-1", "openhat", "tom-1"]
      .filter((k) => SAMPLE_MAP[k]);

    let x = 12;
    for (const name of picks) {
      scene.addPad({ x, y: Math.max(12, H * 0.25), w: pw, h: ph }, name, name);
      x += pw + gap;
    }
    scene.draw();

    // Stubs for buttons you already have in the UI
    detectBtn.onclick = () =>
      alert("Object detection UI coming later. For now: drag pads, click or streak across them to play.");
    recordBtn.onclick = () =>
      alert("Recording pipeline hooks will be added after detection.");
    stopBtn.onclick = () => alert("Stop recording coming with recorder.");
  } catch (e: any) {
    console.error(e);
    alert("Audio init failed: " + (e?.message || e));
  }
})();
