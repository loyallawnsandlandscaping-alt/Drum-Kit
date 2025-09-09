let unlocked=true;
const ctx=new (window.AudioContext||window.webkitAudioContext)();
const NOISE=(()=>{const len=ctx.sampleRate*1.5;const b=ctx.createBuffer(1,len,ctx.sampleRate);const d=b.getChannelData(0);for(let i=0;i<len;i++)d[i]=Math.random()*2-1;return b;})();
let master=ctx.createGain();master.gain.value=1;master.connect(ctx.destination);

export function setUnlocked(v){unlocked=!!v}
export function setGain(v){master.gain.setValueAtTime(v,ctx.currentTime)}

function env(g,t,a,d,s,r,p){g.gain.cancelScheduledValues(t);g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(p,t+a);g.gain.exponentialRampToValueAtTime(Math.max(.0001,s),t+a+d);g.gain.exponentialRampToValueAtTime(.0001,t+a+d+r)}
function noise(){const n=ctx.createBufferSource();n.buffer=NOISE;return n}

export function playSound(id){
  const t=ctx.currentTime;
  switch(id){
    case 'kick': case '808':{const o=ctx.createOscillator();const g=ctx.createGain();o.type='sine';o.connect(g).connect(master);o.frequency.setValueAtTime(id==='808'?80:120,t);o.frequency.exponentialRampToValueAtTime(40,t+(id==='808'?0.35:0.12));env(g,t,0.001,id==='808'?0.2:0.05,0.0001,id==='808'?0.5:0.15,1.2);o.start(t);o.stop(t+(id==='808'?0.6:0.2));}break;
    case 'snare': case 'sn2':{const g=ctx.createGain();const n=noise();const bp=ctx.createBiquadFilter();bp.type='bandpass';bp.frequency.setValueAtTime(id==='sn2'?2500:1800,t);const o=ctx.createOscillator();o.type='triangle';o.frequency.setValueAtTime(180,t);o.connect(g);n.connect(bp).connect(g);g.connect(master);env(g,t,0.001,0.08,0.0001,0.12,1.0);o.start(t);o.stop(t+0.15);n.start(t);n.stop(t+0.15);}break;
    case 'hhc': case 'hho':{const n=noise();const hp=ctx.createBiquadFilter();hp.type='highpass';hp.frequency.setValueAtTime(8000,t);const g=ctx.createGain();n.connect(hp).connect(g).connect(master);if(id==='hhc')env(g,t,0.001,0.03,0.0001,0.05,0.8);else env(g,t,0.001,0.12,0.0001,0.25,0.9);n.start(t);n.stop(t+(id==='hhc'?0.08:0.35));}break;
    case 'clap':{const g=ctx.createGain();const n=noise();const bp=ctx.createBiquadFilter();bp.type='bandpass';bp.frequency.setValueAtTime(1500,t);n.connect(bp).connect(g).connect(master);env(g,t,0.001,0.02,0.0001,0.18,1.2);n.start(t);n.stop(t+0.2);}break;
    case 'tom1': case 'tom2': case 'tom3':{const o=ctx.createOscillator();o.type='sine';const g=ctx.createGain();o.connect(g).connect(master);const f=id==='tom1'?140:id==='tom2'?180:220;o.frequency.setValueAtTime(f,t);o.frequency.exponentialRampToValueAtTime(f*0.6,t+0.2);env(g,t,0.001,0.08,0.0001,0.2,1.0);o.start(t);o.stop(t+0.25);}break;
    case 'rim': case 'blk': case 'clv':{const o=ctx.createOscillator();o.type='square';const g=ctx.createGain();o.connect(g).connect(master);o.frequency.setValueAtTime(id==='rim'?1000:id==='blk'?1200:1500,t);env(g,t,0.001,0.02,0.0001,0.1,0.8);o.start(t);o.stop(t+0.08);}break;
    case 'ride': case 'crash':{const n=noise();const hp=ctx.createBiquadFilter();hp.type='highpass';hp.frequency.setValueAtTime(6000,t);const g=ctx.createGain();n.connect(hp).connect(g).connect(master);env(g,t,0.001,id==='ride'?0.4:0.6,0.0001,id==='ride'?0.8:1.2,0.9);n.start(t);n.stop(t+(id==='ride'?1.3:1.8));}break;
    case 'cow':{const o=ctx.createOscillator();o.type='square';const g=ctx.createGain();const bp=ctx.createBiquadFilter();bp.type='bandpass';bp.frequency.setValueAtTime(700,t);o.connect(bp).connect(g).connect(master);env(g,t,0.001,0.05,0.0001,0.2,0.9);o.start(t);o.stop(t+0.2);}break;
    case 'shk': case 'perc1': case 'perc2': case 'snap':{const n=noise();const g=ctx.createGain();n.connect(g).connect(master);env(g,t,0.001,id==='shk'?0.08:id==='snap'?0.02:0.05,0.0001,id==='shk'?0.12:0.08,0.9);n.start(t);n.stop(t+0.15);}break;
    default: fetch("public/"+id+".wav").then(r=>r.arrayBuffer()).then(b=>ctx.decodeAudioData(b)).then(buf=>{const s=ctx.createBufferSource();s.buffer=buf;s.connect(master);s.start();});
  }
}
