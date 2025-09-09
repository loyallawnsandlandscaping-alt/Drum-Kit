export class Loop{
  constructor(play,getTime){this.playOne=play;this.time=getTime;this.events=[];this.timer=null;this.recording=false;this.start=0;this.len=8}
  startRecording(len){this.events=[];this.recording=true;this.start=performance.now();this.len=len}
  stopRecording(){this.recording=false}
  capture(soundId){if(!this.recording)return;const t=(performance.now()-this.start)/1000;this.events.push({time:t%this.len,soundId})}
  play(len){if(this.timer)return;this.len=len;const s=this.time();const tick=()=>{const now=this.time();const pos=(now-s)%this.len;for(const ev of this.events){const dt=ev.time-pos;if(dt>=0&&dt<0.05)setTimeout(()=>this.playOne(ev.soundId),dt*1000);}};this.timer=setInterval(tick,25)}
  stop(){if(this.timer)clearInterval(this.timer);this.timer=null}
}
