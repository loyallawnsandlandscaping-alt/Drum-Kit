import { supabase } from "./lib/supabase";
import { loadAll, play } from "./audio";
import { startRecording, stopRecording } from "./lib/recorder";

type Pad = {
  id: string;
  x: number;
  y: number;
  sound: string | null;
};

const pads: Pad[] = [];
const soundMap: Record<string, string> = {
  "kick-1": "/kick-1.wav",
  "deepkick": "/deepkick.wav",
  "snare-1": "/snare-1.wav",
  "tom-1": "/tom-1.wav",
  "tom-2": "/tom-2.wav",
  "clap-1": "/clap-1.wav",
  "clap-fat": "/clap-fat.wav",
  "openhat": "/openhat.wav",
  "closedhat-1": "/closedhat-1.wav",
};

// DOM
const loginBtn = document.getElementById("loginBtn") as HTMLButtonElement;
const logoutBtn = document.getElementById("logoutBtn") as HTMLButtonElement;
const detectBtn = document.getElementById("detectBtn") as HTMLButtonElement;
const recordBtn = document.getElementById("recordBtn") as HTMLButtonElement;
const stopBtn = document.getElementById("stopBtn") as HTMLButtonElement;
const padArea = document.getElementById("padArea") as HTMLDivElement;

// Boot logic
async function boot() {
  // load sounds
  await loadAll(soundMap);

  // supabase auth state
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) {
      loginBtn.style.display = "none";
      logoutBtn.style.display = "inline-block";
    } else {
      loginBtn.style.display = "inline-block";
      logoutBtn.style.display = "none";
    }
  });

  loginBtn.onclick = async () => {
    const email = prompt("Enter your email for magic link login:");
    if (email) {
      const { error } = await supabase.auth.signInWithOtp({ email });
      if (error) alert(error.message);
      else alert("Check your email for a login link!");
    }
  };

  logoutBtn.onclick = async () => {
    await supabase.auth.signOut();
    alert("Signed out");
  };

  // detection placeholder
  detectBtn.onclick = () => {
    alert("Detection UI coming later. For now, New Pad / Duplicate, then Assign.");
  };

  // recording
  recordBtn.onclick = async () => {
    try {
      recordBtn.disabled = true;
      stopBtn.disabled = false;
      await startRecording();
      recordBtn.textContent = "● Recording…";
    } catch (e: any) {
      recordBtn.disabled = false;
      stopBtn.disabled = true;
      alert("Record error: " + (e?.message || e));
    }
  };

  stopBtn.onclick = async () => {
    try {
      stopBtn.disabled = true;
      const res = await stopRecording();
      recordBtn.disabled = false;
      recordBtn.textContent = "● Record";

      let msg = `Uploaded!\n\nPath: ${res.path}\nDuration: ${(res.durationMs / 1000).toFixed(1)}s`;
      if (res.publicUrl) msg += `\nSigned URL (1h):\n${res.publicUrl}`;
      const invite = confirm(msg + "\n\nInvite someone to a head-to-head?");
      if (invite) {
        const email = prompt("Opponent email:");
        if (email) {
          await createBattleInvite(email, res.path);
          alert("Invite sent!");
        }
      }
    } catch (e: any) {
      alert("Stop error: " + (e?.message || e));
      recordBtn.disabled = false;
      recordBtn.textContent = "● Record";
    }
  };

  // create starter pad
  addPad();
}

// Pad logic
function addPad() {
  const id = "pad-" + Date.now();
  const pad: Pad = { id, x: 50, y: 50, sound: null };
  pads.push(pad);
  renderPad(pad);
}

function renderPad(pad: Pad) {
  const el = document.createElement("div");
  el.className = "pad";
  el.style.left = pad.x + "px";
  el.style.top = pad.y + "px";
  el.id = pad.id;
  el.innerText = pad.sound || "Assign";

  el.onclick = () => {
    if (!pad.sound) {
      const choices = Object.keys(soundMap).filter(
        (s) => !pads.some((p) => p.sound === s)
      );
      const choice = prompt("Choose sound:\n" + choices.join(", "));
      if (choice && choices.includes(choice)) {
        pad.sound = choice;
        el.innerText = choice;
      }
    } else {
      play(pad.sound);
    }
  };

  padArea.appendChild(el);
}

// Invite helper
async function createBattleInvite(opponentEmail: string, challengerPath: string) {
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) throw new Error("Sign in first");

  await supabase.from("battles").insert({
    challenger_user_id: u.user.id,
    opponent_email: opponentEmail,
    challenger_path: challengerPath,
    status: "pending",
  });
}

// start
boot();
