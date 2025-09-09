import { getMaster } from "../audio";
import { getLocalStream, getRemoteStream } from "./rtc";

let raf = 0;

export type LayoutMode = "SELF_MAIN" | "REMOTE_MAIN";

/**
 * Start the compositor that draws local & remote videos into a canvas,
 * and mixes pad master + mic + remote audio into a single MediaStream.
 *
 * By default, SELF_MAIN shows:
 *   - Local: full frame (mirrored, selfie-style)
 *   - Remote: PiP thumbnail (bottom-right)
 */
export function startCompositor(
  width = 1280,
  height = 720,
  fps = 30,
  layout: LayoutMode = "SELF_MAIN"
): { stream: MediaStream; stop: () => void } {
  const cv = document.getElementById("mixCanvas") as HTMLCanvasElement | null;
  if (!cv) throw new Error("#mixCanvas not found");
  cv.width = width;
  cv.height = height;

  const ctx = cv.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;

  const localV = document.getElementById("localVid") as HTMLVideoElement | null;
  const remoteV = document.getElementById("remoteVid") as HTMLVideoElement | null;

  // PiP thumbnail size/position (you can tweak)
  const thumbW = Math.round(width * 0.28);
  const thumbH = Math.round(height * 0.28);
  const thumbPad = Math.round(Math.min(width, height) * 0.02);
  const thumbX = width - thumbW - thumbPad;
  const thumbY = height - thumbH - thumbPad;

  function draw() {
    // Background
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);

    // Helper to draw a video covering a region (letterbox/crop)
    const drawCover = (
      video: HTMLVideoElement,
      x: number,
      y: number,
      w: number,
      h: number,
      mirror = false
    ) => {
      const vw = video.videoWidth || 16;
      const vh = video.videoHeight || 9;
      const scale = Math.max(w / vw, h / vh);
      const dw = Math.floor(vw * scale);
      const dh = Math.floor(vh * scale);
      const dx = x + Math.floor((w - dw) / 2);
      const dy = y + Math.floor((h - dh) / 2);

      if (mirror) {
        ctx.save();
        ctx.translate(x + w, 0);
        ctx.scale(-1, 1);
        // After mirroring, the target x becomes (x mirrored): the right edge is at (x+w)
        const mx = (x + w) - (dx - x) - dw;
        ctx.drawImage(video, mx, dy, dw, dh);
        ctx.restore();
      } else {
        ctx.drawImage(video, dx, dy, dw, dh);
      }
    };

    // SELF_MAIN → local big, remote small
    if (layout === "SELF_MAIN") {
      if (localV && localV.readyState >= 2) {
        drawCover(localV, 0, 0, width, height, /*mirror*/ true);
      }
      if (remoteV && remoteV.readyState >= 2) {
        // PiP frame with subtle border
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,.45)";
        ctx.shadowBlur = 18;
        ctx.fillStyle = "#10131a";
        roundRect(ctx, thumbX - 2, thumbY - 2, thumbW + 4, thumbH + 4, 14);
        ctx.fill();
        ctx.restore();

        roundClip(ctx, thumbX, thumbY, thumbW, thumbH, 12);
        drawCover(remoteV, thumbX, thumbY, thumbW, thumbH, /*mirror*/ false);
        ctx.restore();
      }

    // REMOTE_MAIN → remote big, local small (not used by you now)
    } else {
      if (remoteV && remoteV.readyState >= 2) {
        drawCover(remoteV, 0, 0, width, height, /*mirror*/ false);
      }
      if (localV && localV.readyState >= 2) {
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,.45)";
        ctx.shadowBlur = 18;
        ctx.fillStyle = "#10131a";
        roundRect(ctx, thumbX - 2, thumbY - 2, thumbW + 4, thumbH + 4, 14);
        ctx.fill();
        ctx.restore();

        roundClip(ctx, thumbX, thumbY, thumbW, thumbH, 12);
        drawCover(localV, thumbX, thumbY, thumbW, thumbH, /*mirror*/ true);
        ctx.restore();
      }
    }

    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);

  // Video from canvas
  const canvasStream = cv.captureStream(fps);
  const videoTrack = canvasStream.getVideoTracks()[0];

  // --- Audio mix: pads master + mic + remote ---
  const master = getMaster();
  const ac = master.context as AudioContext;
  const dest = ac.createMediaStreamDestination();

  // pads → dest
  try { master.connect(dest); } catch {}

  // mic
  const local = getLocalStream();
  if (local) {
    const micNode = ac.createMediaStreamSource(local);
    micNode.connect(dest);
  }

  // remote
  const remote = getRemoteStream();
  if (remote) {
    const remoteNode = ac.createMediaStreamSource(remote);
    remoteNode.connect(dest);
  }

  const mixed = new MediaStream([videoTrack, ...dest.stream.getAudioTracks()]);

  return {
    stream: mixed,
    stop: () => { cancelAnimationFrame(raf); }
  };
}

/** Rounded rect path helper */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Clip to rounded rect */
function roundClip(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
}
