export class MotionTracker{
  constructor(videoEl,width=240,height=180){
    this.v=videoEl;this.w=width;this.h=height;
    this.c=document.createElement("canvas");this.c.width=width;this.c.height=height;this.x=this.c.getContext("2d",{willReadFrequently:true});
    this.prev=null;this.ema=new Float32Array(width*height);this.energy=new Float32Array(width*height);
    this.running=false;this.area=document.getElementById("dupeArea");
    this.alpha=0.35;this.beta=0.65;
  }
  start(){
    if(this.running)return;this.running=true;
    const loop=()=>{if(!this.running)return;this.step();requestAnimationFrame(loop)};requestAnimationFrame(loop);
  }
  stop(){this.running=false}
  step(){
    if(!(this.v.videoWidth>0))return;
    this.x.drawImage(this.v,0,0,this.w,this.h);
    const img=this.x.getImageData(0,0,this.w,this.h);const d=img.data;
    if(!this.prev||this.prev.length!==d.length){this.prev=new Uint8ClampedArray(d);return}
    const E=this.energy, M=this.ema, P=this.prev;
    for(let i=0,j=0;i<d.length;i+=4,j++){
      const g=(d[i]*0.2126+d[i+1]*0.7152+d[i+2]*0.0722);
      const gp=(P[i]*0.2126+P[i+1]*0.7152+P[i+2]*0.0722);
      const diff=(g-gp)/255;
      const m=this.alpha*Math.abs(diff)+ (1-this.alpha)*M[j];
      M[j]=m;
      E[j]=this.beta*Math.abs(diff)+(1-this.beta)*m;
    }
    this.prev.set(d);
  }
  energyInRect(x,y,w,h){
    const rect=this.area.getBoundingClientRect();
    const sx=this.w/rect.width, sy=this.h/rect.height;
    const x0=Math.max(0,Math.floor(x*sx)), y0=Math.max(0,Math.floor(y*sy));
    const x1=Math.min(this.w,Math.ceil((x+w)*sx)), y1=Math.min(this.h,Math.ceil((y+h)*sy));
    let sum=0,count=0;const E=this.energy;
    for(let yy=y0;yy<y1;yy++){let idx=yy*this.w+x0;for(let xx=x0;xx<x1;xx++,idx++){sum+=E[idx];count++}}
    return count?sum/count:0;
  }
}
