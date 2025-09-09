import { playSound, setUnlocked, getAudioTime, preloadBuffers, loadSoundList } from "./audioEngine.js";
import { loadCoco, detectOnce } from "./detection.js";
import { Loop } from "./loop.js";
import { MotionTracker } from "./motion.js";
import { Call } from "./call.js";
import { Battle } from "./battle.js";

const state={betaAll:true,cooldownMs:90,motionThresh:0.05,model:null,stream:null,detections:[],dupes:new Map(),loopLenSec:8,loop:null,mt:null,call:null,battle:null};
const cameraEl=document.getElementById("camera");
const frameCanvas=document.getElementById("frame");
const ctx=frameCanvas.getContext("2d");
const detectedList=document.getElementById("detectedList");
const dupeArea=document.getElementById("dupeArea");
const modelStatus=document.getElementById("modelStatus");
const camStatus=document.getElementById("camStatus");
const loopStatus=document.getElementById("loopStatus");
const callStatus=document.getElementById("callStatus");
const youScore=document.getElementById("youScore");
const oppScore=document.getElementById("oppScore");
const battleTimer=document.getElementById("battleTimer");
const roomIdEl=document.getElementById("roomId");
const btnCall=document.getElementById("btnCall");
const btnAnswer=document.getElementById("btnAnswer");
const btnHangup=document.getElementById("btnHangup");
const btnInstall=document.getElementById("btnInstall");
document.getElementById("year").textContent=new Date().getFullYear();

state.loop=new Loop(playSound, getAudioTime);

if("serviceWorker" in navigator) navigator.serviceWorker.register("/service-worker.js").catch(()=>{});
let deferredPrompt=null;window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e;btnInstall.disabled=false;});
btnInstall.addEventListener("click",async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;btnInstall.disabled=true;});
document.getElementById("btnReset").addEventListener("click",async()=>{if(!("caches" in window))return;const keys=await caches.keys();await Promise.all(keys.map(k=>caches.delete(k)));location.reload();});
document.getElementById("btnHelp").addEventListener("click",()=>document.getElementById("onboard").classList.remove("hidden"));
document.getElementById("btnDismiss").addEventListener("click",()=>document.getElementById("onboard").classList.add("hidden"));
document.getElementById("btnGrant").addEventListener("click",async()=>{await startCamera();document.getElementById("onboard").classList.add("hidden");});
const pwaProgress=document.getElementById("pwaProgress");let p=0;const t=setInterval(()=>{p=Math.min(100,p+5);pwaProgress.style.width=p+"%";if(p===100)clearInterval(t);},120);

const betaAll=document.getElementById("betaAll");
const cooldown=document.getElementById("cooldown");
const motionThresh=document.getElementById("motionThresh");
const loopLen=document.getElementById("loopLen");
betaAll.checked=state.betaAll;betaAll.addEventListener("change",()=>{state.betaAll=betaAll.checked;setUnlocked(state.betaAll);});
cooldown.value=state.cooldownMs;cooldown.addEventListener("input",()=>state.cooldownMs=+cooldown.value);
motionThresh.value=5;motionThresh.addEventListener("input",()=>state.motionThresh=(+motionThresh.value)/100);
loopLen.addEventListener("input",()=>state.loopLenSec=+loopLen.value);

document.getElementById("btnStart").addEventListener("click",startCamera);
document.getElementById("btnCapture").addEventListener("click",captureAndDetect);
document.getElementById("btnDuplicateAll").addEventListener("click",()=>{for(const d of state.detections) createDuplicate(d.id);});

const btnRecord=document.getElementById("btnRecord");
const btnStopRec=document.getElementById("btnStopRec");
const btnPlayLoop=document.getElementById("btnPlayLoop");
const btnStopLoop=document.getElementById("btnStopLoop");

btnRecord.addEventListener("click",()=>{state.loop.startRecording(state.loopLenSec);loopStatus.textContent="loop: recording…";btnRecord.disabled=true;btnStopRec.disabled=false;btnPlayLoop.disabled=true;btnStopLoop.disabled=true;});
btnStopRec.addEventListener("click",()=>{state.loop.stopRecording();btnRecord.disabled=false;btnStopRec.disabled=true;btnPlayLoop.disabled=state.loop.events.length===0;btnStopLoop.disabled=true;loopStatus.textContent="loop: ready";});
btnPlayLoop.addEventListener("click",()=>{state.loop.play(state.loopLenSec);btnPlayLoop.disabled=true;btnStopLoop.disabled=false;loopStatus.textContent="loop: playing…";});
btnStopLoop.addEventListener("click",()=>{state.loop.stop();btnPlayLoop.disabled=false;btnStopLoop.disabled=true;loopStatus.textContent="loop: idle";});

btnCall.addEventListener("click",async()=>{
  const room=roomIdEl.value.trim(); if(!room) return;
  await setupCall(room,"caller");
});
btnAnswer.addEventListener("click",async()=>{
  const room=roomIdEl.value.trim(); if(!room) return;
  await setupCall(room,"callee");
  await state.call.answer();
});
btnHangup.addEventListener("click",async()=>{
  if(state.call){await state.call.hangup();}
  callStatus.textContent="call: idle";
  btnHangup.disabled=true;
});

async function setupCall(room,role){
  state.call=new Call(room);
  const ui={ status:(s)=>callStatus.textContent="call: "+s, setScores:(a,b)=>{youScore.textContent=a;oppScore.textContent=b;}, timer:(t)=>battleTimer.textContent=t };
  state.battle=new Battle((msg)=>state.call.sendData(msg), ui);
  state.call.onConnected=()=>{ui.status("connected");btnHangup.disabled=false;state.battle.connected();state.battle.start();};
  state.call.onRinging=()=>{ui.status("ringing…");state.battle.ring();};
  state.call.onData=(d)=>state.battle.remoteData(d);
  await state.call.init(role==="caller"?"caller":"callee");
  if(role==="caller"){ui.status("calling…");}
  else {ui.status("ready to answer");}
}

async function startCamera(){
  try{
    state.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment",width:{ideal:1280},height:{ideal:720}},audio:false});
    cameraEl.srcObject=state.stream;camStatus.textContent="camera: live";
    state.mt=new MotionTracker(cameraEl,240,180);state.mt.start();
    startTriggerLoop();
  }catch(e){
    camStatus.textContent="camera: permission denied";document.getElementById("onboard").classList.remove("hidden");
  }
}

async function captureAndDetect(){
  await preloadBuffers();
  if(!state.model){modelStatus.textContent="loading coco-ssd…";state.model=await loadCoco();modelStatus.textContent="loaded ✓";}
  frameCanvas.width=cameraEl.videoWidth||640;frameCanvas.height=cameraEl.videoHeight||480;ctx.drawImage(cameraEl,0,0);
  const preds=await detectOnce(state.model,frameCanvas);
  state.detections=preds.map((p,i)=>({id:"det"+i,class:p.class,score:p.score,bbox:p.bbox}));
  renderDetections();
}

function renderDetections(){
  detectedList.innerHTML="";
  for(const det of state.detections){
    const item=document.createElement("div");item.className="detected-item";
    item.innerHTML=`
      <div class="row"><strong>${det.class} <span class="badge">${(det.score*100).toFixed(0)}%</span></strong>
      <span class="status">(${Math.round(det.bbox[2])}×${Math.round(det.bbox[3])})</span></div>
      <div class="row"><label>Drum: <select data-det="${det.id}"></select></label><button data-dup="${det.id}">Duplicate</button></div>`;
    detectedList.appendChild(item);
  }
  populateSoundSelects();
  detectedList.querySelectorAll('button[data-dup]').forEach(b=>b.addEventListener("click",()=>createDuplicate(b.getAttribute("data-dup"))));
}

async function populateSoundSelects(){
  const list=await loadSoundList();
  const unlocked=(s)=>state.betaAll||s.group==="free";
  detectedList.querySelectorAll("select").forEach(sel=>{
    sel.innerHTML=list.map(s=>`<option value="${s.id}" ${unlocked(s)?"":"disabled"}>${s.name}${unlocked(s)?"":" (paid)"}</option>`).join("");
  });
  setUnlocked(state.betaAll);
}

function createDuplicate(detId){
  const det=state.detections.find(d=>d.id===detId);if(!det)return;
  if(state.dupes.has(detId))return;
  const el=document.createElement("div");el.className="dupe";el.textContent=det.class;
  const [x,y,w,h]=det.bbox;
  const rect=dupeArea.getBoundingClientRect();
  const sx=rect.width/(frameCanvas.width||640), sy=rect.height/(frameCanvas.height||480);
  const bx=x*sx, by=y*sy, bw=w*sx, bh=h*sy;
  el.style.left=bx+"px";el.style.top=by+"px";el.style.width=bw+"px";el.style.height=bh+"px";
  dupeArea.appendChild(el);
  const sel=detectedList.querySelector(`select[data-det="${detId}"]`);
  state.dupes.set(detId,{el,bbox:{x:bx,y:by,w:bw,h:bh},soundId:sel?sel.value:null,lastHit:0,armed:true});
  let dragging=false,ox=0,oy=0;
  el.addEventListener("pointerdown",e=>{dragging=true;el.setPointerCapture(e.pointerId);ox=e.offsetX;oy=e.offsetY;});
  el.addEventListener("pointermove",e=>{if(!dragging)return;const rx=e.clientX-dupeArea.getBoundingClientRect().left-ox;const ry=e.clientY-dupeArea.getBoundingClientRect().top-oy;const nx=Math.max(0,Math.min(rx,dupeArea.clientWidth-el.clientWidth));const ny=Math.max(0,Math.min(ry,dupeArea.clientHeight-el.clientHeight));el.style.left=nx+"px";el.style.top=ny+"px";const d=state.dupes.get(detId);d.bbox.x=nx;d.bbox.y=ny;});
  el.addEventListener("pointerup",()=>dragging=false);
  el.addEventListener("click",()=>{const d=state.dupes.get(detId);if(d&&d.soundId){playSound(d.soundId);state.loop.capture(d.soundId);if(state.battle)state.battle.localHit();}});
}

function startTriggerLoop(){
  const high=()=>state.motionThresh;
  const low=()=>high()*0.5;
  function tick(){
    for(const [id,d] of state.dupes.entries()){
      const e=state.mt.energyInRect(d.bbox.x,d.bbox.y,d.bbox.w,d.bbox.h);
      const now=performance.now();
      if(d.armed && e>high() && (!d.lastHit || (now-d.lastHit)>state.cooldownMs)){
        d.lastHit=now;d.armed=false;if(d.soundId){playSound(d.soundId);state.loop.capture(d.soundId);if(state.battle)state.battle.localHit();}
      }
      if(!d.armed && e<low()){d.armed=true}
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
