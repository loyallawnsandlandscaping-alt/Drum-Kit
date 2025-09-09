import { supabase } from "./supabase.js";

export class Call {
  constructor(room) {
    this.room = room;
    this.pc = null;
    this.dc = null;
    this.chan = null;
    this.localStream = null;
    this.remoteAudio = null;
    this.onConnected = () => {};
    this.onRinging = () => {};
    this.onData = () => {};
  }
  async init(role) {
    this.remoteAudio = document.createElement("audio");
    this.remoteAudio.autoplay = true;
    this.remoteAudio.playsInline = true;
    this.chan = supabase.channel("call:" + this.room, { config: { broadcast: { ack: true } } });
    this.chan.on("broadcast", { event: "signal" }, (p) => this.onSignal(p.payload));
    await this.chan.subscribe();
    this.pc = new RTCPeerConnection({ iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }] });
    this.pc.onicecandidate = (e) => { if (e.candidate) this.send({ t: "ice", c: e.candidate }); };
    this.pc.ontrack = (e) => { this.remoteAudio.srcObject = e.streams[0]; };
    this.pc.ondatachannel = (e) => { this.bindDataChannel(e.channel); };
    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.localStream.getTracks().forEach(t => this.pc.addTrack(t, this.localStream));
    if (role === "caller") {
      this.bindDataChannel(this.pc.createDataChannel("battle"));
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      await this.send({ t: "offer", s: offer });
      this.onRinging();
    }
  }
  async answer() {
    const offer = this._pendingOffer;
    if (!offer) return;
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this.send({ t: "answer", s: answer });
  }
  bindDataChannel(dc) {
    this.dc = dc;
    this.dc.onmessage = (e) => { try { this.onData(JSON.parse(e.data)); } catch {} };
    this.dc.onopen = () => { this.onConnected(); };
  }
  async onSignal(msg) {
    if (msg.t === "offer") {
      this._pendingOffer = msg.s;
    } else if (msg.t === "answer") {
      await this.pc.setRemoteDescription(new RTCSessionDescription(msg.s));
    } else if (msg.t === "ice") {
      try { await this.pc.addIceCandidate(new RTCIceCandidate(msg.c)); } catch {}
    }
  }
  sendData(obj) {
    if (this.dc && this.dc.readyState === "open") this.dc.send(JSON.stringify(obj));
  }
  async send(payload) {
    await this.chan.send({ type: "broadcast", event: "signal", payload });
  }
  async hangup() {
    if (this.dc) this.dc.close();
    if (this.pc) this.pc.close();
    if (this.localStream) this.localStream.getTracks().forEach(t => t.stop());
    if (this.chan) await this.chan.unsubscribe();
  }
}
