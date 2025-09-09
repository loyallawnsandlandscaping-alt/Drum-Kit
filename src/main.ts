import { loadAll, play } from "./audio";
import { Scene } from "./pads/scene";

/**
 * Map sound names → public URLs.
 * You currently have these in /public (root of site), so paths start with "/".
 * Add more entries later as you upload more.
 */
const SAMPLE_MAP: Record<string, string> = {
  snare: "/snare.wav",
  bass: "/bass.wav",
  hihat: "/hihat.wav",
  tom: "/tom.wav",
  bell: "/bell.wav"
};

// ---- DOM handles from index.html ----
const stage = document.getElementById("stage") as HTMLDivElement;
const photoInput = document.getElementById("photoInput") as HTMLInputElement;
const detectBtn = document.getElementById("detectBtn") as HTMLButtonElement;
const recordBtn = document.getElementById("recordBtn") as HTMLButtonElement;
const stopBtn = document.getElementById("stopBtn") as HTMLButtonElement;

// Initialize scene (pads are DOM nodes inside #stage)
const scene = new Scene(stage, () => scene.draw());

// Basic pointer interactions for pads
function stagePos(e: PointerEvent) {
  const r = stage.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  return { x, y };
}
stage.addEventListener("pointerdown", (e) => {
  const { x, y } = stagePos(e);
  const pad = scene["pointerDown"]?.(x, y);
  // If we clicked a pad, preview its sound
  if (pad) play(pad.sample);
});
stage.addEventListener("pointermove", (e) => {
  const { x, y } = stagePos(e);
  scene["pointerMove"]?.(x, y);
});
stage.addEventListener("pointerup", () => scene["pointerUp"]?.());
stage.addEventListener("pointerleave", () => scene["pointerUp"]?.());

// Load audio and set up a few starter pads so the app runs immediately
(async function boot() {
  try {
    await loadAll(SAMPLE_MAP);

    // Add five starter pads laid out in a row; you can drag them
    const W = stage.clientWidth || 960;
    const H = stage.clientHeight || 480;
    const pw = 140, ph = 120, gap = 12;
    const labels = Object.keys(SAMPLE_MAP);
    const picks = labels.slice(0, 5);

    let x = 12;
    for (const name of picks) {
      scene.addPad(
        { x, y: Math.max(12, H * 0.25), w: pw, h: ph },
        name,
        name
      );
      x += pw + gap;
    }
    scene.draw();

    // Enable basic controls
    detectBtn.onclick = async () => {
      // Placeholder: object detection / suggestions will be added next.
      alert("Object detection coming up next. For now, drag & tap pads to play.");
    };

    // Simple stub for recording UI (we'll wire real recording later)
    recordBtn.onclick = () => alert("Recording will be added after detection step.");
    stopBtn.onclick = () => alert("Stop recording will be added after detection step.");
  } catch (e: any) {
    console.error(e);
    alert("Audio load failed: " + (e?.message || e));
  }
})();
