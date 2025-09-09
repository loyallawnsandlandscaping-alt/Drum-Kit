import { supabase } from "./supabase";

type RTCState = {
  pc: RTCPeerConnection | null;
  room: string | null;
  chan: ReturnType<typeof supabase.channel> | null;
  local: MediaStream | null;
  remote: MediaStream | null;
};
const S: RTCState = { pc: null, room: null, chan: null, local: null, remote: null };

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
};

function $<T extends HTMLElement>(id: string) { return document.getElementById(id) as T | null; }

async function ensureChannel(room: string) {
  if (S.chan && S.room === room) return S.chan;
  if (S.chan) try { await S.chan.unsubscribe(); } catch {}
  S.room = room;
  const chan = supabase.channel(`webrtc:${room}`, { config: { broadcast: { ack: true } } });
  await chan.subscribe(() => {});
  S.chan = chan;
  return chan;
}

async function send(type: string, payload: any) {
  if (!S.chan) throw new Error("No signaling channel");
  const { data } = await supabase.auth.getUser();
  await S.chan.send({ type: "broadcast", event: type, payload: { from: data.user?.id, ...payload } });
}

function attachLocal(stream: MediaStream) {
  S.local = stream;
  const v = $<HTMLVideoElement>("localVid");
  const a = $<HTMLAudioElement>("localAudio");
  if (v) { v.srcObject = stream; v.muted = true; }
  if (a) { a.srcObject = stream; a.muted = true; }
}

function attachRemote(stream: MediaStream) {
  S.remote = stream;
  const v = $<HTMLVideoElement>("remoteVid");
  const a = $<HTMLAudioElement>("remoteAudio");
  if (v) v.srcObject = stream;
  if (a) a.srcObject = stream;
}

export function getRemoteStream() { return S.remote; }
export function getLocalStream()  { return S.local;  }

export async function joinRoom(room: string) {
  if (S.pc) throw new Error("Already in a call");
  if (!room) throw new Error("Room required");

  const chan = await ensureChannel(room);
  const pc = new RTCPeerConnection(RTC_CONFIG);
  S.pc = pc;

  // Remote stream sink
  const remote = new MediaStream();
  attachRemote(remote);
  pc.addEventListener("track", (e) => {
    e.streams[0]?.getTracks().forEach(t => remote.addTrack(t));
  });

  // Local A/V
  const local = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  attachLocal(local);
  local.getTracks().forEach(t => pc.addTrack(t, local));

  // ICE
  pc.onicecandidate = (e) => { if (e.candidate) send("ice", { candidate: e.candidate }); };

  // Signaling
  chan.on("broadcast", { event: "offer" }, async ({ payload }) => {
    if (!pc.currentLocalDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      await send("answer", { sdp: ans });
    }
  });
  chan.on("broadcast", { event: "answer" }, async ({ payload }) => {
    if (pc.signalingState === "have-local-offer") {
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
    }
  });
  chan.on("broadcast", { event: "ice" }, async ({ payload }) => {
    try { await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)); } catch {}
  });

  // Try to be the caller
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await send("offer", { sdp: offer });
}

export async function leaveRoom() {
  try { await S.chan?.unsubscribe(); } catch {}
  S.chan = null; S.room = null;

  if (S.pc) {
    S.pc.getSenders().forEach(s => s.track && s.track.stop());
    S.pc.close(); S.pc = null;
  }
  if (S.local) { S.local.getTracks().forEach(t => t.stop()); S.local = null; }
  S.remote = null;
}
