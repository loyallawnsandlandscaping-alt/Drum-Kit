// src/lib/rtc.ts
import { supabase } from "./supabase";

export type RTCEvents = {
  onRemoteStream?: (stream: MediaStream) => void;
  onStatus?: (status: 'pending'|'ringing'|'active'|'ended') => void;
  onError?: (err: string) => void;
};

type SignalType = 'offer'|'answer'|'candidate';

export class DrumRTC {
  private pc: RTCPeerConnection;
  private callId: string | null = null;
  private stopRealtime?: () => void;
  private events: RTCEvents;
  private localStream?: MediaStream;
  private iceQueue: RTCIceCandidateInit[] = [];
  private uid?: string;
  private email?: string;

  constructor(events: RTCEvents = {}) {
    this.events = events;
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }]
    });

    this.pc.ontrack = (e) => {
      const stream = e.streams?.[0];
      if (stream && this.events.onRemoteStream) this.events.onRemoteStream(stream);
    };

    this.pc.onicecandidate = async (e) => {
      if (!e.candidate || !this.callId || !this.uid) return;
      await this.insertSignal('candidate', { candidate: e.candidate });
    };
  }

  async initAuth() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) throw new Error('Not authenticated');
    this.uid = user.id;
    this.email = user.email ?? undefined;
  }

  addLocalStream(stream: MediaStream) {
    this.localStream = stream;
    stream.getTracks().forEach(t => this.pc.addTrack(t, stream));
  }

  /** Caller creates a call to a callee email */
  async createCall(calleeEmail: string) {
    await this.initAuth();
    const { data: callRow, error: callErr } = await supabase
      .from('calls')
      .insert({ caller_id: this.uid, callee_email: calleeEmail, status: 'pending' })
      .select()
      .single();
    if (callErr || !callRow) throw new Error(callErr?.message || 'Call create failed');
    this.callId = callRow.id;

    await this.subscribeRealtime();

    // Create offer
    const offer = await this.pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await this.pc.setLocalDescription(offer);
    await this.insertSignal('offer', offer);

    if (this.events.onStatus) this.events.onStatus('ringing');
    return callRow.id as string;
  }

  /** Callee joins by callId (e.g., from invite link or list) */
  async answerCall(callId: string) {
    await this.initAuth();
    this.callId = callId;
    await this.subscribeRealtime();

    // We’ll wait for the offer from caller via realtime and then setRemote → createAnswer.
    if (this.events.onStatus) this.events.onStatus('ringing');
  }

  /** Caller or callee ends call */
  async endCall() {
    try {
      if (this.callId) {
        await supabase.from('calls').update({ status: 'ended' }).eq('id', this.callId);
      }
    } finally {
      this.teardown();
    }
  }

  private teardown() {
    this.stopRealtime?.();
    this.stopRealtime = undefined;
    this.callId = null;
    try { this.pc.getSenders().forEach(s => s.track?.stop()); } catch {}
    try { this.pc.close(); } catch {}
    if (this.events.onStatus) this.events.onStatus('ended');
  }

  private async insertSignal(type: SignalType, payload: any) {
    if (!this.callId || !this.uid) return;
    await supabase.from('signals').insert({
      call_id: this.callId,
      sender_id: this.uid,
      type,
      payload
    });
  }

  private async subscribeRealtime() {
    if (!this.callId) throw new Error('No callId to subscribe');

    // Live changes to signals for this call
    const sub = supabase
      .channel(`signals-${this.callId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'signals', filter: `call_id=eq.${this.callId}` },
        async (payload) => {
          const { type, payload: body, sender_id } = payload.new as any;
          // Ignore our own inserts
          const my = (await supabase.auth.getUser()).data.user?.id;
          if (sender_id === my) return;

          try {
            if (type === 'offer') {
              // Callee path
              await this.pc.setRemoteDescription(new RTCSessionDescription(body));
              const answer = await this.pc.createAnswer();
              await this.pc.setLocalDescription(answer);
              await this.insertSignal('answer', answer);
              await supabase.from('calls').update({ status: 'active' }).eq('id', this.callId);
              if (this.events.onStatus) this.events.onStatus('active');
            } else if (type === 'answer') {
              // Caller path
              if (!this.pc.currentRemoteDescription) {
                await this.pc.setRemoteDescription(new RTCSessionDescription(body));
                await supabase.from('calls').update({ status: 'active' }).eq('id', this.callId);
                if (this.events.onStatus) this.events.onStatus('active');
              }
            } else if (type === 'candidate') {
              // ICE
              await this.pc.addIceCandidate(new RTCIceCandidate(body.candidate));
            }
          } catch (err: any) {
            this.events.onError?.(String(err?.message || err));
          }
        }
      )
      .subscribe();

    this.stopRealtime = () => { try { supabase.removeChannel(sub); } catch {} };
  }
}
