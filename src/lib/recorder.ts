import { supabase } from "./supabase";
import { getMaster } from "../audio";

export type RecordingResult = {
  path: string;            // storage path
  publicUrl?: string;      // signed URL (temporary)
  durationMs: number;
};

let mediaDest: MediaStreamAudioDestinationNode | null = null;
let micStream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let chunks: BlobPart[] = [];
let startedAt = 0;

/** Prepare a mixed MediaStream of (pads -> master) + microphone */
async function buildMixedStream(): Promise<MediaStream> {
  const master = getMaster();
  const ctx = (master.context as AudioContext);

  if (!mediaDest) mediaDest = ctx.createMediaStreamDestination();

  // pad audio → mediaDest (in addition to normal speakers)
  // master can fan out to multiple destinations
  try { master.connect(mediaDest); } catch {}

  // mic
  if (!micStream) {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  }

  // Merge tracks into a single stream
  const merged = new MediaStream();
  mediaDest.stream.getAudioTracks().forEach(t => merged.addTrack(t));
  micStream.getAudioTracks().forEach(t => merged.addTrack(t));
  return merged;
}

/** Start recording (returns once recorder is rolling) */
export async function startRecording(mime: string = "audio/webm;codecs=opus") {
  if (recorder) throw new Error("Recorder already running");
  const stream = await buildMixedStream();

  if (!MediaRecorder.isTypeSupported(mime)) {
    // safe fallback
    mime = "audio/webm";
  }

  recorder = new MediaRecorder(stream, { mimeType: mime });
  chunks = [];
  recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  recorder.start(100); // gather small chunks
  startedAt = performance.now();
}

/** Stop recording, upload to Supabase storage, insert metadata, return signed URL */
export async function stopRecording(): Promise<RecordingResult> {
  if (!recorder) throw new Error("No active recording");
  const r = recorder;
  const done = new Promise<Blob>((resolve) => {
    r.onstop = () => resolve(new Blob(chunks, { type: r.mimeType || "audio/webm" }));
  });
  r.stop();
  recorder = null;

  const blob = await done;
  const durationMs = Math.max(0, performance.now() - startedAt);

  // ensure auth
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) throw new Error("You must be signed in to upload");

  // storage path: recordings/{userId}/{timestamp}.webm
  const fname = `${Date.now()}.webm`;
  const path = `recordings/${auth.user.id}/${fname}`;

  const { data: up, error: upErr } = await supabase.storage
    .from("recordings")
    .upload(path, blob, {
      contentType: blob.type || "audio/webm",
      upsert: false
    });

  if (upErr) throw upErr;

  // insert row in recordings table
  const { error: insErr } = await supabase.from("recordings").insert({
    user_id: auth.user.id,
    path,
    duration_ms: Math.round(durationMs)
  });
  if (insErr) throw insErr;

  // signed URL (1 hour)
  const { data: signed } = await supabase.storage
    .from("recordings")
    .createSignedUrl(path, 3600);

  return { path, publicUrl: signed?.signedUrl, durationMs };
}

