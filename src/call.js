// src/call.js
// WebRTC + Supabase Realtime (Broadcast) signaling + DataChannel messaging

import { supabase } from "./supabase.js";

let pc = null;
let dc = null;
let channel = null;
let roomId = null;
let onMsg = () => {};
let pingTimer = 0;

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478?transport=udp" },
];

/* ------------------ Helpers ------------------ */
function channelName(id) {
  return `rtc:${id}`;
}

function broadcast(payload) {
  if (!channel) return;
  channel.send({ type: "broadcast", event: "signal", payload });
}

async function teardownChannel() {
  try { if (channel) await channel.unsubscribe(); } catch {}
  channel = null;
  roomId = null;
}

/* ------------------ Supabase Realtime ------------------ */
async function ensureChannel(id) {
  if (channel && roomId === id) return channel;
  await teardownChannel();

  roomId = id;
  channel = supabase.channel(channelName(id), {
    config: { broadcast: { self: false } },
  });

  channel.on("broadcast", { event: "signal" }, async ({ payload }) => {
    ensurePC();

    if (payload.type === "offer" && payload.sdp) {
      // Answerer path
      const desc = new RTCSessionDescription(payload.sdp);
      if (!pc.currentRemoteDescription) {
        await pc.setRemoteDescription(desc);
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      broadcast({ type: "answer", sdp: pc.localDescription });
    } else if (payload.type === "answer" && payload.sdp) {
      // Caller path
      if (!pc.currentRemoteDescription) {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      }
    } else if (payload.type === "ice" && payload.candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } catch {
        // ignore bad/late candidates
      }
    }
  });

  await channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      const el = document.getElementById("callStatus");
      if (el) el.textContent = `call: room ${id}`;
    }
  });

  return channel;
}

/* ------------------ WebRTC ------------------ */
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
    if (s === "failed" || s === "disconnected" || s === "closed") {
      stopPings();
    }
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
    startPings();
  };

  dc.onclose = () => {
    const el = document.getElementById("callStatus");
    if (el) el.textContent = "call: closed";
    stopPings();
  };

  dc.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      onMsg(msg);
    } catch {
      // ignore non-JSON (like pings)
    }
  };
}

/* ------------------ Keepalive Pings ------------------ */
function startPings() {
  stopPings();
  pingTimer = window.setInterval(() => {
    if (dc?.readyState === "open") {
      try {
        dc.send('{"type":"ping"}');
      } catch {}
    }
  }, 15000); // 15s ping
}

function stopPings() {
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = 0;
}

/* ------------------ Public API ------------------ */
export async function call(id) {
  await ensureChannel(id);
  ensurePC();

  // Caller proactively creates the DataChannel
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

export function onMessage(cb) {
  onMsg = typeof cb === "function" ? cb : () => {};
}

export async function hangup() {
  stopPings();

  try { if (dc) dc.close(); } catch {}
  dc = null;

  try { if (pc) pc.close(); } catch {}
  pc = null;

  await teardownChannel();

  const el = document.getElementById("callStatus");
  if (el) el.textContent = "call: idle";
}
