import { supabase } from "./lib/supabase";
import { play, loadAll } from "./audio";

// Map sound names to file paths
const sounds: Record<string, string> = {
  kick: "/public/kick-1.wav",
  snare: "/public/snare-1.wav",
  tom1: "/public/tom-1.wav",
  tom2: "/public/tom-2.wav",
  hihat: "/public/closedhat-1.wav",
  openhat: "/public/openhat.wav",
  clap: "/public/clap-1.wav",
  clapFat: "/public/clap-fat.wav",
  deepkick: "/public/deepkick.wav"
};

// State
let assigned: Record<string, string> = {};
let localStream: MediaStream | null = null;
let peer: RTCPeerConnection | null = null;

// UI Elements
const loginDiv = document.getElementById("login")!;
const emailInput = document.getElementById("email") as HTMLInputElement;
const loginBtn = document.getElementById("login-btn")!;
const cameraDiv = document.getElementById("camera-container")!;
const controlsDiv = document.getElementById("controls")!;
const callDiv = document.getElementById("call-container")!;

const localVideo = document.getElementById("localVideo") as HTMLVideoElement;
const selfView = document.getElementById("selfView") as HTMLVideoElement;
const remoteView = document.getElementById("remoteView") as HTMLVideoElement;

const assignBtn = document.getElementById("assign-btn")!;
const recordBtn = document.getElementById("record-btn")!;
const callBtn = document.getElementById("call-btn")!;

// --- Auth ---
loginBtn.addEventListener("click", async () => {
  const { error } = await supabase.auth.signInWithOtp({
    email: emailInput.value,
  });
  if (error) alert("Login error: " + error.message);
  else {
    loginDiv.classList.add("hidden");
    cameraDiv.classList.remove("hidden");
    controlsDiv.classList.remove("hidden");
    startCamera();
    await loadAll(sounds);
  }
});

// --- Camera ---
async function startCamera() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;
  selfView.srcObject = localStream;
}

// --- Assign sound to object copy ---
assignBtn.addEventListener("click", () => {
  const available = Object.keys(sounds).filter(s => !Object.values(assigned).includes(s));
  if (available.length === 0) {
    alert("All sounds already assigned!");
    return;
  }
  // Fake "object copy" id for now
  const copyId = "copy-" + (Object.keys(assigned).length + 1);
  assigned[copyId] = available[0];
  alert(`Assigned ${available[0]} to ${copyId}`);
});

// --- Collision simulation ---
function simulateCollision(copyId: string) {
  const sound = assigned[copyId];
  if (sound) play(sound);
}

// --- Loop recording ---
let recording: string[] = [];
recordBtn.addEventListener("click", () => {
  if (recording.length > 0) {
    alert("Stopping loop.");
    recording = [];
  } else {
    alert("Recording a loop. Trigger some collisions!");
    // Simulate capturing collisions
    setInterval(() => {
      if (Object.keys(assigned).length > 0) {
        const copyId = Object.keys(assigned)[Math.floor(Math.random() * Object.keys(assigned).length)];
        simulateCollision(copyId);
        recording.push(copyId);
      }
    }, 500);
  }
});

// --- WebRTC Call ---
callBtn.addEventListener("click", async () => {
  peer = new RTCPeerConnection();
  localStream?.getTracks().forEach(track => peer!.addTrack(track, localStream!));

  peer.ontrack = (event) => {
    remoteView.srcObject = event.streams[0];
  };

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);

  // NOTE: Here we’d push offer/answer through Supabase Realtime
  console.log("Offer created:", offer.sdp?.substring(0, 60));
});
