import { loadAll, play } from "./audio";
import { Scene, Pad } from "./pads/scene";
import { crossesEdge } from "./pads/collide";
import { signInEmailLink, signOutAll, onAuth } from "./lib/session";

// Sounds you uploaded in /public (root)
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

// ---- DOM ----
const stage = document.getElementById("stage") as HTMLDivElement;
const detectBtn = document.getElementById("detectBtn") as HTMLButtonElement;
const recordBtn = document.getElementById("recordBtn") as HTMLButtonElement;
const stopBtn = document.getElementById("stopBtn") as HTMLButtonElement;

// header auth buttons (already in your index.html header)
const loginBtn = document.getElementById("loginBtn") as HTMLButtonElement | null;
const logoutBtn = document.getElementById("logoutBtn") as HTMLButtonElement | null;

// pad controls
const newPadBtn = document.getElementById("newPadBtn") as HTMLButtonElement;
const dupPadBtn = document.getElementById("dupPadBtn") as HTMLButtonElement;
const delPadBtn = document.getElementById("delPadBtn") as HTMLButtonElement;
const soundSelect = document.getElementById("soundSelect") as HTMLSelectElement;
const assignBtn = document.getElementById("assignBtn") as HTMLButtonElement;

// Scene
const scene = new Scene(stage, () => scene.draw());
let selected: Pad | null = null;

// Keep track of which sounds are assigned (unique per pad assignment)
const assigned = new Set<string>(); // sample keys assigned at least once by user choice

function refreshPicker() {
  const all = Object.keys(SAMPLE_MAP);
  const available = all.filter(k => !assigned.has(k));
  soundSelect.innerHTML = available.map(k => `<option value="${k}">${k}</option>`).join("");
  if (available.length === 0) {
    soundSelect.innerHTML = `<option value="">(none available)</option>`;
  }
}

function selectPad(pad: Pad | null) {
  selected = pad;
  // Visual: outline selected
  stage.querySelectorAll(".pad").forEach(el => el.classList.remove("sel"));
  if (pad) {
    const el = stage.querySelector(`.pad[data-id="${pad.id}"]`);
    el?.classList.add("sel");
  }
}

// pointer helpers
let lastPt: { x: number; y: number } | null = null;
function stagePos(e: PointerEvent) {
  const r = stage.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

stage.addEventListener("pointerdown", (e) => {
  const p = stagePos(e);
  lastPt = { ...p };
  const pad = scene["pointerDown"]?.(p.x, p.y);
  if (pad) {
    selectPad(pad);
    play(pad.sample);
  } else {
    selectPad(null);
  }
});

stage.addEventListener("pointermove", (e) => {
  const p = stagePos(e);
  scene["pointerMove"]?.(p.x, p.y);

  if (lastPt) {
    for (const pad of scene.pads) {
      const rect = { x: pad.x, y: pad.y, w: pad.w, h: pad.h };
      if (crossesEdge(lastPt, p, rect)) {
        play(pad.sample);
      }
    }
  }
  lastPt = { ...p };
});

["pointerup", "pointerleave", "pointercancel"].forEach((ev) =>
  stage.addEventListener(ev, () => { scene["pointerUp"]?.(); lastPt = null; })
);

// UI: New Pad → creates a pad and forces user to assign a unique sound
newPadBtn.onclick = () => {
  const W = stage.clientWidth || 960;
  const H = stage.clientHeight || 480;
  const pad = scene.addPad({ x: 20, y: Math.max(12, H * 0.25), w: 140, h: 120 }, "Pad", "");
  selectPad(pad);
  refreshPicker();
  alert("Pick a sound from the dropdown, then click Assign.");
};

// UI: Duplicate (copy) → duplicate the selected pad; user assigns a sound to the “copy” pad
dupPadBtn.onclick = () => {
  if (!selected) return alert("Select a pad first.");
  const c = scene.addPad(
    { x: selected.x + 16, y: selected.y + 16, w: selected.w, h: selected.h },
    selected.label + " copy",
    "" // force user to pick
  );
  selectPad(c);
  refreshPicker();
  alert("This is a copy. Choose a sound for it from the dropdown, then Assign.");
};

// UI: Delete
delPadBtn.onclick = () => {
  if (!selected) return alert("Select a pad first.");
  // if that pad had a unique assignment, free it up
  if (selected.sample && assigned.has(selected.sample)) {
    assigned.delete(selected.sample);
  }
  scene.removePad(selected.id);
  selectPad(null);
  refreshPicker();
};

// UI: Assign button → assign chosen sound to selected pad (enforce uniqueness)
assignBtn.onclick = () => {
  if (!selected) return alert("Select a pad first.");
  const choice = soundSelect.value;
  if (!choice) return alert("No sound available to assign.");
  if (assigned.has(choice)) return alert("That sound is already assigned.");
  selected.sample = choice;
  selected.label = choice;
  assigned.add(choice);
  scene.draw();
  refreshPicker();
};

// Auth buttons
loginBtn?.addEventListener("click", () => signInEmailLink());
logoutBtn?.addEventListener("click", () => signOutAll());
onAuth((user) => {
  if (loginBtn && logoutBtn) {
    loginBtn.style.display = user ? "none" : "inline-flex";
    logoutBtn.style.display = user ? "inline-flex" : "none";
  }
});

// Boot
(async function boot() {
  try {
    await loadAll(SAMPLE_MAP);

    // starter layout with 4 prewired pads (not counted as “assigned by picker”)
    const H = stage.clientHeight || 480;
    const base = ["kick-1", "snare-1", "openhat", "tom-1"].filter(k => SAMPLE_MAP[k]);
    let x = 12;
    for (const name of base) {
      scene.addPad({ x, y: Math.max(12, H * 0.25), w: 140, h: 120 }, name, name);
      x += 152;
    }
    scene.draw();
    refreshPicker();

    detectBtn.onclick = () => alert("Detection UI coming later. For now, New Pad / Duplicate, then Assign.");
    recordBtn.onclick = () => alert("Recording pipeline coming next.");
    stopBtn.onclick = () => {};
  } catch (e: any) {
    console.error(e);
    alert("Audio init failed: " + (e?.message || e));
  }
})();
