import { supabase } from "./supabase";

let pc: RTCPeerConnection | null = null;
let channel: ReturnType<typeof supabase.channel> | null = null;
let localStream: MediaStream | null = null;
let remoteStream: MediaStream | null = null;

const iceServers: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

export function getLocalStream() { return localStream; }
export function getRemoteStream() { return remoteStream; }

export async function initLocalMedia(opts = { video: true, audio: true }) {
  localStream = await navigator.mediaDevices.getUserMedia(opts);
  return localStream;
}

function setupPC(onRemote: (stream: MediaStream) => void) {
  if (pc) pc.close();
  pc = new RTCPeerConnection({ iceServers });

  remoteStream = new MediaStream();
  pc.ontrack = (ev) => {
    ev.streams[0].getTracks().forEach(tr => remoteStream!.addTrack(tr));
    onRemote(remoteStream!);
  };

  pc.onicecandidate = async (ev) => {
    if (ev.candidate && channel) {
      await channel.send({ type: "broadcast", event: "signal", payload: { type: "candidate", payload: ev.candidate } });
    }
  };

  if (localStream) {
    localStream.getTracks().forEach(t => pc!.addTrack(t, localStream!));
  }

  return pc;
}

async function joinRoom(room: string, onSignal: (msg: any) => void) {
  if (channel) await channel.unsubscribe();
  channel = supabase.channel(`webrtc:${room}`, { config: { broadcast: { ack: true } } });
  channel.on("broadcast", { event: "signal" }, ({ payload }) => onSignal(payload));
  await channel.subscribe();
}

export async function call(room: string, onRemote: (s: MediaStream) => void) {
  await joinRoom(room, async (msg) => {
    if (msg.type === "answer") {
      await pc!.setRemoteDescription(new RTCSessionDescription(msg.payload));
    } else if (msg.type === "candidate") {
      try { await pc!.addIceCandidate(new RTCIceCandidate(msg.payload)); } catch {}
    }
  });

  setupPC(onRemote);
  const offer = await pc!.createOffer();
  await pc!.setLocalDescription(offer);

  await channel!.send({ type: "broadcast", event: "signal", payload: { type: "offer", payload: offer } });
}

export async function waitForCall(room: string, onRemote: (s: MediaStream) => void) {
  await joinRoom(room, async (msg) => {
    if (msg.type === "offer") {
      setupPC(onRemote);
      await pc!.setRemoteDescription(new RTCSessionDescription(msg.payload));
      const answer = await pc!.createAnswer();
      await pc!.setLocalDescription(answer);
      await channel!.send({ type: "broadcast", event: "signal", payload: { type: "answer", payload: answer } });
    } else if (msg.type === "candidate") {
      try { await pc!.addIceCandidate(new RTCIceCandidate(msg.payload)); } catch {}
    }
  });
}

export async function hangup() {
  if (channel) await channel.unsubscribe();
  if (pc) { pc.close(); pc = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
}
