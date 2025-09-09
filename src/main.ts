import { loadAll, play } from "./audio";
import { Scene, Pad } from "./pads/scene";
import { crossesEdge } from "./pads/collide";
import { supabase } from "./lib/supabase";
import { signInEmailLink, signOutAll, onAuth } from "./lib/session";

/** Map the WAVs you uploaded to /public */
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

// header auth
const loginBtn = document.getElementById("loginBtn") as HTMLButtonElement | null;
const logoutBtn = document.getElementById("logoutBtn") as HTMLButtonElement | null;

// pad controls
const newPadBtn = document.getElementById("newPadBtn") as HTMLButtonElement;
const dupPadBtn = document.getElementById("dupPadBtn") as HTMLButtonElement;
const delPadBtn = document.getElementById("delPadBtn") as HTMLButtonElement;
const soundSelect = document.getElementById("soundSelect") as HTMLSelectElement;
const assignBtn = document.getElementById("assignBtn") as HTMLButtonElement;

// ---- Scene + selection ----
const scene = new Scene(stage, () => scene.draw());
let selected: Pad | null = null;

// sounds assigned through the picker (unique constraint)
const assigned = new Set<string>();

function refreshPicker() {
  const all = Object.keys(SAMPLE_MAP);
  const available = all.filter(k => !assigned.has(k));
  soundSelect.innerHTML = available.length
    ? available.map(k => `<option value="${k}">${k}</option>`).join("")
    : `<option value="">(none available)</option>`;
}

function selectPad(p: Pad | null) {
  selected = p;
  stage.querySelectorAll(".pad").forEach(el => el.classList.remove("sel"));
  if (p) stage.querySelector(`.pad[data-id="${p.id}"]`)?.classList.add("sel");
}

// ---- Pointer input + edge-cross detection ----
let lastPt: { x: number; y: number } | null = null;
function stagePos(e: PointerEvent) {
  const r = stage.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

stage.addEventListener("pointerdown", (e) => {
  const p = stagePos(e);
  lastPt = { ...p };
  const pad = scene["pointerDown"]?.(p.x, p.y);
  if (pad) { selectPad(pad); play(pad.sample); } else { selectPad(null); }
});

stage.addEventListener("pointermove", (e) => {
  const p = stagePos(e);
  scene["pointerMove"]?.(p.x, p.y);

  if (lastPt) {
    for (const pad of scene.pads) {
      if (crossesEdge(lastPt, p, { x: pad.x, y: pad.y, w: pad.w, h: pad.h })) {
        play(pad.sample); // stacked pads can all fire
      }
    }
    lastPt = { ...p };
  }
});

["pointerup","pointerleave","pointercancel"].forEach(ev =>
  stage.addEventListener(ev, () => { scene["pointerUp"]?.(); lastPt = null; saveLayoutSoon(); })
);

// ---- Pad controls ----
newPadBtn.onclick = () => {
  const H = stage.clientHeight || 480;
  const pad = scene.addPad({ x: 20, y: Math.max(12, H * 0.25), w: 140, h: 120 }, "Pad", "");
  selectPad(pad);
  refreshPicker();
  alert("Pick a sound from the dropdown, then click Assign.");
  saveLayoutSoon();
};

dupPadBtn.onclick = () => {
  if (!selected) return alert("Select a pad first.");
  const copy = scene.addPad(
    { x: selected.x + 16, y: selected.y + 16, w: selected.w, h: selected.h },
    selected.label + " copy",
    "" // force user to assign for this copy
  );
  selectPad(copy);
  refreshPicker();
  alert("This is a copy. Choose a sound for it from the dropdown, then Assign.");
  saveLayoutSoon();
};

delPadBtn.onclick = () => {
  if (!selected) return alert("Select a pad first.");
  if (selected.sample && assigned.has(selected.sample)) assigned.delete(selected.sample);
  scene.removePad(selected.id);
  selectPad(null);
  refreshPicker();
  saveLayoutSoon();
};

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
  saveLayoutSoon();
};

// ---- Persist (Supabase autosave if logged in; otherwise localStorage) ----
type KitData = { pads: Array<{id:string;x:number;y:number;w:number;h:number;label:string;sample:string}> };

function serialize(): KitData {
  return {
    pads: scene.pads.map(p => ({
      id: p.id, x: p.x, y: p.y, w: p.w, h: p.h, label: p.label, sample: p.sample
    }))
  };
}

function restore(data: KitData) {
  scene.clear();
  for (const p of data.pads) {
    scene.addPad({ x:p.x, y:p.y, w:p.w, h:p.h }, p.label, p.sample);
  }
  // rebuild uniqueness set from assigned pads (only count non-empty samples)
  assigned.clear();
  for (const p of scene.pads) if (p.sample) assigned.add(p.sample);
  scene.draw();
  refreshPicker();
}

const LS_KEY = "kit-autosave";
let saveTimer: number | null = null;
function saveLayoutSoon() {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveLayout, 500);
}

async function saveLayout() {
  const layout = serialize();
  // local first
  try { localStorage.setItem(LS_KEY, JSON.stringify(layout)); } catch {}
  // if signed in, upsert to Supabase
  const { data: u } = await supabase.auth.getUser();
  if (u?.user) {
    await supabase.from("kits").upsert({
      user_id: u.user.id,
      name: "autosave",
      data: layout
    }, { onConflict: "user_id,name" });
  }
}

async function loadLayout() {
  // try Supabase first
  const { data: u } = await supabase.auth.getUser();
  if (u?.user) {
    const { data, error } = await supabase
      .from("kits")
      .select("data")
      .eq("user_id", u.user.id)
      .eq("name", "autosave")
      .maybeSingle();
    if (!error && data?.data) {
      restore(data.data as KitData);
      return;
    }
  }
  // fallback localStorage
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) restore(JSON.parse(raw));
  } catch {}
}

// ---- Auth buttons ----
loginBtn?.addEventListener("click", () => signInEmailLink());
logoutBtn?.addEventListener("click", () => signOutAll());
onAuth((user) => {
  if (loginBtn && logoutBtn) {
    loginBtn.style.display = user ? "none" : "inline-flex";
    logoutBtn.style.display = user ? "inline-flex" : "none";
  }
  // when auth changes, attempt a load (pull cloud autosave if present)
  loadLayout().then(() => saveLayoutSoon());
});

// ---- Audio unlock (iOS/Autoplay policy) ----
function unlockAudio() {
  // Creating/resuming an AudioContext here ensures first pad hit is instant.
  const AC: any = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AC) return;
  const ctx: AudioContext = (window as any).__djctx || new AC();
  (window as any).__djctx = ctx;
  if (ctx.state === "suspended") ctx.resume();
}
window.addEventListener("touchstart", unlockAudio, { once: true });
window.addEventListener("pointerdown", unlockAudio, { once: true });

// ---- Boot ----
(async function boot() {
  try {
    await loadAll(SAMPLE_MAP);

    // initial layout (does not consume uniqueness; user can reassign later)
    const H = stage.clientHeight || 480;
    const base = ["kick-1", "snare-1", "openhat", "tom-1"].filter(k => SAMPLE_MAP[k]);
    let x = 12;
    for (const name of base) {
      scene.addPad({ x, y: Math.max(12, H * 0.25), w: 140, h: 120 }, name, name);
      x += 152;
    }
    scene.draw();
    refreshPicker();

    // attempt to restore saved kit (cloud or local) after initial render
    await loadLayout();

    detectBtn.onclick = () => alert("Detection UI coming later. For now, New Pad / Duplicate, then Assign.");
    recordBtn.onclick = () => alert("Recording pipeline coming next.");
    stopBtn.onclick = () => {};
  } catch (e: any) {
    console.error(e);
    alert("Audio init failed: " + (e?.message || e));
  }
})();
