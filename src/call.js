// UPDATED call.js (keeps Supabase + UI flow, adds WebRTC DC + lifecycle)
import { supabase } from "./supabase.js";

let pc = null;
let dc = null;
let channel = null;
let roomId = null;
let onMsg = () => {};

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478?transport=udp" }
];

function ensurePC() {
  if (pc) return;
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  pc.onicecandidate = (e) => {
    if (e.candidate) broadcast({ type: "ice", candidate: e.candidate });
  };

  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    const el = document.getElementById("callStatus");
    if (el) el.textContent = `call: ${s}`;
  };

  pc.ondatachannel = (e) => {
    dc = e.channel;
    wireDC();
  };
}

function wireDC() {
  if (!dc) return;
  dc.onopen = () => {
    const el = document.getElementById("callStatus");
    if (el) el.textContent = "call: connected";
  };
  dc.onclose = () => {
    const el = document.getElementById("callStatus");
    if (el) el.textContent = "call: closed";
  };
  dc.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      onMsg(msg);
    } catch {}
  };
}

function channelName(id) {
  return `rtc:${id}`;
}

async function ensureChannel(id) {
  if (channel && roomId === id) return channel;
  if (channel) {
    try { await channel.unsubscribe(); } catch {}
  }
  roomId = id;
  channel = supabase.channel(channelName(id), {
    config: { broadcast: { self: false } }
  });

  channel.on("broadcast", { event: "signal" }, async ({ payload }) => {
    if (!pc) ensurePC();

    if (payload.type === "offer") {
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      broadcast({ type: "answer", sdp: pc.localDescription });
    } else if (payload.type === "answer") {
      if (!pc.currentRemoteDescription) {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      }
    } else if (payload.type === "ice" && payload.candidate) {
      try { await pc.addIceCandidate(new RTCIceCandidate(payload.candidate)); } catch {}
    }
  });

  await channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      const el = document.getElementById("callStatus");
      if (el) el.textContent = `call: room ${id}`;
    }
  });
  return channel;
}

function broadcast(payload) {
  if (!channel) return;
  channel.send({ type: "broadcast", event: "signal", payload });
}

// --- PUBLIC API (same names, extended features) ---
export async function call(id) {
  await ensureChannel(id);
  ensurePC();

  // Caller proactively creates DC
  dc = pc.createDataChannel("battle");
  wireDC();

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  broadcast({ type: "offer", sdp: pc.localDescription });
}

export async function answer(id) {
  await ensureChannel(id);
  ensurePC();
}

export function send(obj) {
  if (dc && dc.readyState === "open") {
    dc.send(JSON.stringify(obj));
  }
}

export function onMessage(cb) { onMsg = cb || (()=>{}); }

export async function hangup() {
  try { if (dc) dc.close(); } catch {}
  dc = null;
  try { if (pc) pc.close(); } catch {}
  pc = null;
  try { if (channel) await channel.unsubscribe(); } catch {}
  channel = null;
  roomId = null;
  const el = document.getElementById("callStatus");
  if (el) el.textContent = "call: idle";
}
