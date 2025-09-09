import { supabase } from "./lib/supabase";
import { loadAll, play } from "./audio";

const authDiv = document.getElementById("auth")!;
const appDiv = document.getElementById("app")!;
const loginBtn = document.getElementById("loginBtn")!;
const signupBtn = document.getElementById("signupBtn")!;
const logoutBtn = document.getElementById("logoutBtn")!;
const startCallBtn = document.getElementById("startCallBtn")!;

const emailInput = document.getElementById("email") as HTMLInputElement;
const passwordInput = document.getElementById("password") as HTMLInputElement;

const padsDiv = document.getElementById("pads")!;
const localVideo = document.getElementById("localVideo") as HTMLVideoElement;
const remoteVideo = document.getElementById("remoteVideo") as HTMLVideoElement;

// Preload samples from /public
const samples: Record<string, string> = {
  "Kick": "/kick-1.wav",
  "DeepKick": "/deepkick.wav",
  "Snare": "/snare-1.wav",
  "Clap": "/clap-1.wav",
  "OpenHat": "/openhat.wav",
  "ClosedHat": "/closedhat-1.wav",
  "Tom1": "/tom-1.wav",
  "Tom2": "/tom-2.wav",
};
await loadAll(samples);

// Auth handlers
loginBtn.addEventListener("click", async () => {
  const { error } = await supabase.auth.signInWithPassword({
    email: emailInput.value,
    password: passwordInput.value,
  });
  if (error) alert(error.message);
});
signupBtn.addEventListener("click", async () => {
  const { error } = await supabase.auth.signUp({
    email: emailInput.value,
    password: passwordInput.value,
  });
  if (error) alert(error.message);
});
logoutBtn.addEventListener("click", async () => {
  await supabase.auth.signOut();
});

// Watch auth state
supabase.auth.onAuthStateChange((_event, session) => {
  if (session) {
    authDiv.style.display = "none";
    appDiv.style.display = "block";
    initPads();
    initMedia();
  } else {
    authDiv.style.display = "block";
    appDiv.style.display = "none";
  }
});

// Pad setup
function initPads() {
  padsDiv.innerHTML = "";
  Object.entries(samples).forEach(([name]) => {
    const div = document.createElement("div");
    div.className = "pad";
    div.textContent = name;
    div.onclick = () => play(name);
    padsDiv.appendChild(div);
  });
}

// Media + WebRTC
let pc: RTCPeerConnection;
async function initMedia() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = stream;

  pc = new RTCPeerConnection();
  stream.getTracks().forEach(t => pc.addTrack(t, stream));
  pc.ontrack = e => { remoteVideo.srcObject = e.streams[0]; };

  startCallBtn.addEventListener("click", startCall);
}

// For demo only (head-to-head signaling needs Supabase RLS table or WebSocket later)
async function startCall() {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  alert("Call started. Signaling not implemented yet.");
}
