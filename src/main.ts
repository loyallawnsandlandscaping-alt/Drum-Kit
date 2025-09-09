import { supabase } from "./lib/supabase";
import { DrumRTC } from "./lib/rtc";
import { findPendingForMe } from "./lib/sessions";
import { startLocalRecording, stopRecording, RecState } from "./lib/recorder";
import { initPads, enablePlacing, onCollision, getCopyIds } from "./pads/scene";
import { loadAll, play } from "./audio";

/* sound palette (matches /public) */
const sounds: Record<string,string> = {
  kick: "/kick-1.wav",
  snare: "/snare-1.wav",
  tom1: "/tom-1.wav",
  tom2: "/tom-2.wav",
  hihat: "/closedhat-1.wav",
  openhat: "/openhat.wav",
  clap: "/clap-1.wav",
  clapFat: "/clap-fat.wav",
  deepkick: "/deepkick.wav"
};

/* ---------- State ---------- */
let assigned: Record<string, keyof typeof sounds> = {};
let localStream: MediaStream | null = null;
let rec: RecState | null = null;
let rtc: DrumRTC | null = null;

/* ---------- UI refs ---------- */
const loginDiv = document.getElementById("login")!;
const emailInput = document.getElementById("email") as HTMLInputElement;
const loginBtn   = document.getElementById("login-btn") as HTMLButtonElement;

const cameraDiv  = document.getElementById("camera-container")!;
const callDiv    = document.getElementById("call-container")!;
const callStatus = document.getElementById("call-status")!;

const localVideo = document.getElementById("localVideo") as HTMLVideoElement;
const remoteView = document.getElementById("remoteView") as HTMLVideoElement;

const overlay = document.getElementById("padCanvas") as HTMLCanvasElement;

const addCopyBtn = document.getElementById("add-copy-btn") as HTMLButtonElement;
const assignBtn  = document.getElementById("assign-btn") as HTMLButtonElement;
const recordBtn  = document.getElementById("record-btn") as HTMLButtonElement;
const saveBtn    = document.getElementById("save-btn") as HTMLButtonElement;
const shareBtn   = document.getElementById("share-btn") as HTMLButtonElement;
const callBtn    = document.getElementById("call-btn") as HTMLButtonElement;

/* ---------- Auth ---------- */
loginBtn.addEventListener("click", async () => {
  const email = (emailInput.value || "").trim();
  if (!email) return alert("Enter your email first.");
  const { error } = await supabase.auth.signInWithOtp({ email });
  if (error) return alert("Login error: " + error.message);
  loginDiv.classList.add("hidden");
  cameraDiv.classList.remove("hidden");
  await boot();
});

async function boot() {
  await startCamera();
  await loadAll(sounds);
  initPads(localVideo, overlay);

  // collision → play assigned sound (no duplicates)
  onCollision((copyId) => {
    const s = assigned[copyId];
    if (s) play(s);
  });

  // incoming call?
  try {
    const call = await findPendingForMe();
    if (call && confirm("Incoming drummer call. Answer now?")) {
      await startAnswer(call.id as string);
    }
  } catch {}
}

/* ---------- Camera ---------- */
async function startCamera() {
  localStream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
  localVideo.srcObject = localStream;
}

/* ---------- Copy placement & assignment ---------- */
addCopyBtn.addEventListener("click", () => {
  enablePlacing();
  alert("Click on the big self video to place a copy pad.");
});

assignBtn.addEventListener("click", () => {
  const ids = getCopyIds();
  if (!ids.length) return alert("Place at least one copy first.");

  const taken = new Set(Object.values(assigned));
  const available = Object.keys(sounds).filter(k => !taken.has(k));
  if (!available.length) return alert("All sounds already assigned.");

  // assign in creation order, first unassigned copy
  const target = ids.find(id => !assigned[id]);
  if (!target) return alert("All copies already have sounds.");
  const choice = available[0] as keyof typeof sounds;
  assigned[target] = choice;
  alert(`Assigned ${choice} to ${target}`);
});

/* ---------- Recording ---------- */
recordBtn.addEventListener("click", () => {
  if (!localStream) return;
  if (rec) {
    stopRecording(rec); rec = null; recordBtn.textContent = "Record"; return;
  }
  rec = startLocalRecording(localStream, (blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = "drum-session.webm"; a.click();
  });
  recordBtn.textContent = "Stop";
});

/* save/share placeholders – wire to Storage later */
saveBtn.addEventListener("click", () => alert("Storage upload coming next."));
shareBtn.addEventListener("click", () => alert("Share flow coming next."));

/* ---------- Call flow (self large, remote small) ---------- */
function ensureRTC() {
  if (rtc) return;
  rtc = new DrumRTC({
    onRemoteStream: (s) => { remoteView.srcObject = s; },
    onStatus: (s) => { callStatus.textContent = s; },
    onError: (m) => console.warn("RTC:", m)
  });
}

callBtn.addEventListener("click", async () => {
  const callee = prompt("Enter drummer's email to call:");
  if (!callee) return;
  ensureRTC(); if (!rtc || !localStream) return;
  rtc.addLocalStream(localStream);
  try {
    await rtc.createCall(callee);
    callDiv.classList.remove("hidden");
  } catch (e: any) { alert("Call failed: " + (e?.message || e)); }
});

async function startAnswer(callId: string) {
  ensureRTC(); if (!rtc || !localStream) return;
  rtc.addLocalStream(localStream);
  try {
    await rtc.answerCall(callId);
    callDiv.classList.remove("hidden");
  } catch (e: any) { alert("Answer failed: " + (e?.message || e)); }
}
