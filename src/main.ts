 // src/main.ts
import { supabase } from "./lib/supabase";
import { play, loadAll } from "./audio";
import { DrumRTC } from "./lib/rtc";
import { findPendingForMe } from "./lib/sessions";

/** Map of sound display-name -> file path in /public */
const sounds: Record<string, string> = {
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

// ---------- State ----------
let assigned: Record<string, keyof typeof sounds> = {};
let localStream: MediaStream | null = null;
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let rtc: DrumRTC | null = null;

// ---------- UI ----------
const loginDiv = document.getElementById("login")!;
const emailInput = document.getElementById("email") as HTMLInputElement;
const loginBtn = document.getElementById("login-btn")!;

const cameraDiv = document.getElementById("camera-container")!;
const controlsDiv = document.getElementById("controls")!;
const callDiv = document.getElementById("call-container")!;

const localVideo = document.getElementById("localVideo") as HTMLVideoElement;
const selfView = document.getElementById("selfView") as HTMLVideoElement;
const remoteView = document.getElementById("remoteView") as HTMLVideoElement;

const assignBtn = document.getElementById("assign-btn") as HTMLButtonElement;
const recordBtn = document.getElementById("record-btn") as HTMLButtonElement;
const callBtn = document.getElementById("call-btn") as HTMLButtonElement;
const saveBtn = document.getElementById("save-btn") as HTMLButtonElement;
const shareBtn = document.getElementById("share-btn") as HTMLButtonElement;

// ---------- Auth ----------
loginBtn.addEventListener("click", async () => {
  const email = (emailInput.value || "").trim();
  if (!email) return alert("Enter your email first.");
  const { error } = await supabase.auth.signInWithOtp({ email });
  if (error) return alert("Login error: " + error.message);

  loginDiv.classList.add("hidden");
  cameraDiv.classList.remove("hidden");
  controlsDiv.classList.remove("hidden");

  await startCamera();
  await loadAll(sounds);

  // After login, also auto-check for incoming call to your email:
  maybeAutoAnswer();
});

async function maybeAutoAnswer() {
  try {
    const pending = await findPendingForMe();
    if (pending) {
      const ok = confirm(`Incoming call from a drummer. Answer now?`);
      if (ok) await startAnswerFlow(pending.id as string);
    }
  } catch (e) {
    console.warn("Auto-answer check failed:", e);
  }
}

// ---------- Camera ----------
async function startCamera() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;
  selfView.srcObject = localStream;
}

// ---------- Assign sound to a new "copy" (no duplicate sounds) ----------
assignBtn.addEventListener("click", () => {
  const taken = new Set(Object.values(assigned));
  const available = Object.keys(sounds).filter(s => !taken.has(s as any));
  if (!available.length) {
    alert("All sounds already assigned.");
    return;
  }
  const copyId = `copy-${Object.keys(assigned).length + 1}`;
  const chosen = available[0] as keyof typeof sounds;
  assigned[copyId] = chosen;
  alert(`Assigned ${chosen} to ${copyId}`);
});

// ---------- Collision trigger (placeholder) ----------
function triggerCollision(copyId: string) {
  const soundKey = assigned[copyId];
  if (soundKey) play(soundKey);
}

// ---------- Loop / Recording ----------
recordBtn.addEventListener("click", () => {
  if (!localStream) return;

  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    recordBtn.textContent = "Record";
    return;
  }

  mediaRecorder = new MediaRecorder(localStream, { mimeType: "video/webm;codecs=vp9,opus" });
  recordedChunks = [];

  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "drum-session.webm"; a.click();
  };

  mediaRecorder.start();
  recordBtn.textContent = "Stop";
});

// Optional: save/share placeholders
saveBtn.addEventListener("click", () => alert("Save to Supabase Storage coming next."));
shareBtn.addEventListener("click", () => alert("Social share coming next."));

// ---------- Call flow ----------
callBtn.addEventListener("click", async () => {
  const callee = prompt("Enter drummer's email to call:");
  if (!callee) return;

  await startCallerFlow(callee);
});

async function startCallerFlow(calleeEmail: string) {
  ensureRTC();
  if (!rtc || !localStream) return;
  rtc.addLocalStream(localStream);

  // Create call + send offer over Supabase (inside DrumRTC)
  try {
    await rtc.createCall(calleeEmail);
    callDiv.classList.remove("hidden");
  } catch (e: any) {
    alert("Call failed: " + (e?.message || e));
  }
}

async function startAnswerFlow(callId: string) {
  ensureRTC();
  if (!rtc || !localStream) return;
  rtc.addLocalStream(localStream);

  try {
    await rtc.answerCall(callId);
    callDiv.classList.remove("hidden");
  } catch (e: any) {
    alert("Answer failed: " + (e?.message || e));
  }
}

function ensureRTC() {
  if (rtc) return;
  rtc = new DrumRTC({
    onRemoteStream: (stream) => { remoteView.srcObject = stream; },
    onStatus: (s) => { console.log("Call status:", s); },
    onError: (err) => { console.warn("RTC error:", err); }
  });
}
