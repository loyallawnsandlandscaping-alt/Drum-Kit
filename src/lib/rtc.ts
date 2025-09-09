// src/lib/rtc.ts
import { supabase } from "./supabase";

export type RTCEvents = {
  onRemoteStream?: (stream: MediaStream) => void;
  onStatus?: (s: 'pending'|'ringing'|'active'|'ended') => void;
  onError?: (err: string) => void;
};

type SigType = 'offer'|'answer'|'candidate';

export class DrumRTC {
  private pc: RTCPeerConnection;
  private callId: string | null = null;
  private stopRealtime?: () => void;
  private events: RTCEvents;
  private uid?: string;
  private localStream?: MediaStream;

  constructor(events: RTCEvents = {}) {
    this.events = events;
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }]
    });

    this.pc.ontrack = (e) => {
      const s = e.streams?.[0];
      if (s && this.events.onRemoteStream) this.events.onRemoteStream(s);
    };

    this.pc.onicecandidate = async (e) => {
      if (!e.candidate || !this.callId || !this.uid) return;
      await this.insertSignal('candidate', { candidate: e.candidate });
    };
  }

  private async ensureAuth() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) throw new Error('Not authenticated');
    this.uid = user.id;
  }

  addLocalStream(stream: MediaStream) {
    this.localStream = stream;
    stream.getTracks().forEach(t => this.pc.addTrack(t, stream));
  }

  async createCall(calleeEmail: string) {
    await this.ensureAuth();

    const { data: call, error: callErr } = await supabase
      .from('calls')
      .insert({ caller_id: this.uid, callee_email: calleeEmail, status: 'pending' })
      .select().single();

    if (callErr || !call) throw new Error(callErr?.message || 'Call create failed');
    this.callId = call.id;

    await this.subscribe();

    const offer = await this.pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true });
    await this.pc.setLocalDescription(offer);
    await this.insertSignal('offer', offer);
    this.events.onStatus?.('ringing');
    return call.id as string;
  }

  async answerCall(callId: string) {
    await this.ensureAuth();
    this.callId = callId;
    await this.subscribe();
    this.events.onStatus?.('ringing');
  }

  async endCall() {
    try {
      if (this.callId) await supabase.from('calls').update({ status: 'ended' }).eq('id', this.callId);
    } finally {
      this.teardown();
    }
  }

  private teardown() {
    this.stopRealtime?.();
    this.stopRealtime = undefined;
    try { this.pc.getSenders().forEach(s => s.track?.stop()); } catch {}
    try { this.pc.close(); } catch {}
    this.callId = null;
    this.events.onStatus?.('ended');
  }

  private async insertSignal(type: SigType, payload: any) {
    if (!this.callId || !this.uid) return;
    await supabase.from('signals').insert({
      call_id: this.callId,
      sender_id: this.uid,
      type, payload
    });
  }

  private async subscribe() {
    if (!this.callId) throw new Error('missing call id');
    const ch = supabase
      .channel(`signals-${this.callId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'signals', filter: `call_id=eq.${this.callId}` },
        async (payload) => {
          const row: any = payload.new;
          const me = (await supabase.auth.getUser()).data.user?.id;
          if (row.sender_id === me) return; // ignore own

          try {
            if (row.type === 'offer') {
              await this.pc.setRemoteDescription(new RTCSessionDescription(row.payload));
              const answer = await this.pc.createAnswer();
              await this.pc.setLocalDescription(answer);
              await this.insertSignal('answer', answer);
              await supabase.from('calls').update({ status: 'active' }).eq('id', this.callId);
              this.events.onStatus?.('active');
            } else if (row.type === 'answer') {
              if (!this.pc.currentRemoteDescription) {
                await this.pc.setRemoteDescription(new RTCSessionDescription(row.payload));
                await supabase.from('calls').update({ status: 'active' }).eq('id', this.callId);
                this.events.onStatus?.('active');
              }
            } else if (row.type === 'candidate') {
              await this.pc.addIceCandidate(new RTCIceCandidate(row.payload.candidate));
            }
          } catch (e: any) {
            this.events.onError?.(String(e?.message || e));
          }
        })
      .subscribe();
    this.stopRealtime = () => { try { supabase.removeChannel(ch); } catch {} };
  }
}
