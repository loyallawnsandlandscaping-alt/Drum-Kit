import { supabase } from "./lib/supabase";
import { play, loadAll } from "./audio";

// Map sound names to file paths
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

// --- State ---
let assigned: Record<string, string> = {};
let localStream: MediaStream | null = null;
let peer: RTCPeerConnection | null = null;

// --- UI Elements ---
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
  const copyId = "copy-" + (Object.keys(assigned).length + 1);
  assigned[copyId] = available[0];
  alert(`Assigned ${available[0]} to ${copyId}`);
});

// --- Collision simulation (to be replaced with detection) ---
function simulateCollision(copyId: string) {
  const sound = assigned[copyId];
  if (sound) play(sound);
}

// --- Loop recording ---
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];

recordBtn.addEventListener("click", () => {
  if (!localStream) return;
  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    alert("Stopped recording.");
  } else {
    mediaRecorder = new MediaRecorder(localStream, { mimeType: "video/webm;codecs=vp9,opus" });
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    };
    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: "video/webm" });
      recordedChunks = [];
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "drumloop.webm";
      a.click();
    };
    mediaRecorder.start();
    alert("Recording started!");
  }
});

// --- WebRTC Call with Supabase Realtime Signaling ---
callBtn.addEventListener("click", async () => {
  peer = new RTCPeerConnection();
  localStream?.getTracks().forEach(track => peer!.addTrack(track, localStream!));

  peer.ontrack = (event) => {
    remoteView.srcObject = event.streams[0];
  };

  // Listen for ICE candidates
  peer.onicecandidate = async (event) => {
    if (event.candidate) {
      await supabase.from("signals").insert({
        type: "candidate",
        data: JSON.stringify(event.candidate)
      });
    }
  };

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);

  await supabase.from("signals").insert({
    type: "offer",
    data: JSON.stringify(offer)
  });

  // Subscribe to answers
  supabase.channel("webrtc").on("postgres_changes",
    { event: "INSERT", schema: "public", table: "signals" },
    async (payload) => {
      const { type, data } = payload.new;
      if (type === "answer" && peer && !peer.currentRemoteDescription) {
        await peer.setRemoteDescription(JSON.parse(data));
      }
      if (type === "candidate" && peer) {
        await peer.addIceCandidate(JSON.parse(data));
      }
    }
  ).subscribe();
});
