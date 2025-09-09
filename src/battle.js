// UPDATED battle.js (adds battle logic, keeps pad + recorder integration)
import { send, onMessage } from "./call.js";

let you = 0;
let opp = 0;
let timerId = 0;
let endAt = 0;
let active = false;

const youEl = () => document.getElementById("youScore");
const oppEl = () => document.getElementById("oppScore");
const tEl   = () => document.getElementById("battleTimer");
const statusEl = () => document.getElementById("callStatus");

function setScores() {
  const a = youEl(); if (a) a.textContent = String(you);
  const b = oppEl(); if (b) b.textContent = String(opp);
}

function setTimer(sec) {
  const t = tEl();
  if (t) t.textContent = sec < 0 ? "--" : String(sec);
}

function tick() {
  const remain = Math.max(0, Math.ceil((endAt - performance.now()) / 1000));
  setTimer(remain);
  if (remain <= 0) {
    stopBattle();
  } else {
    timerId = window.setTimeout(tick, 250);
  }
}

// --- PUBLIC API ---
export function startBattle(seconds = 60) {
  if (active) stopBattle();
  you = 0; opp = 0; setScores();
  endAt = performance.now() + seconds * 1000;
  setTimer(seconds);
  active = true;
  const s = statusEl(); if (s) s.textContent = "battle: live";
  if (timerId) clearTimeout(timerId);
  tick();
  send({ type: "battle:start", seconds });
}

export function stopBattle() {
  active = false;
  if (timerId) clearTimeout(timerId);
  timerId = 0;
  setTimer(-1);
  const s = statusEl(); if (s) s.textContent = "battle: ended";
  send({ type: "battle:stop" });
}

export function registerLocalHit(padId) {
  if (!active) return;
  you++;
  setScores();
  send({ type: "hit", padId, t: Date.now() });
}

// --- Incoming sync messages ---
onMessage((msg) => {
  if (!msg || typeof msg !== "object") return;
  switch (msg.type) {
    case "battle:start":
      if (!active) {
        you = 0; opp = 0; setScores();
        endAt = performance.now() + (msg.seconds || 60) * 1000;
        active = true;
        const s = statusEl(); if (s) s.textContent = "battle: live";
        if (timerId) clearTimeout(timerId);
        tick();
      }
      break;
    case "battle:stop":
      if (active) stopBattle();
      break;
    case "hit":
      if (!active) return;
      opp++;
      setScores();
      break;
  }
});
