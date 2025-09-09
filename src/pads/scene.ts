export type Pad = {
  id: string;
  x: number; y: number; w: number; h: number;  // pixels in canvas space
  label: string;
  sample: string;            // key from SAMPLE_MAP
  pattern: boolean[];        // 16-step looper state
};

export class Scene {
  pads: Pad[] = [];
  private dragging: Pad | null = null;
  private dragOff = { x: 0, y: 0 };

  constructor(public canvas: HTMLDivElement, private onChange: ()=>void) {}

  addPad(box: {x:number;y:number;w:number;h:number}, label: string, sample: string) {
    const id = "p" + Math.random().toString(36).slice(2,8);
    const pad: Pad = {
      id, x: box.x, y: box.y, w: box.w, h: box.h,
      label, sample,
      pattern: new Array(16).fill(false)
    };
    this.pads.push(pad);
    this.onChange();
    return pad;
  }

  removePad(id: string) {
    this.pads = this.pads.filter(p => p.id !== id);
    this.onChange();
  }

  draw() {
    // Pads are DOM absolutely-positioned inside #stage
    // Remove old nodes
    this.canvas.querySelectorAll(".pad").forEach(n => n.remove());

    for (const p of this.pads) {
      const el = document.createElement("div");
      el.className = "pad";
      el.style.left = p.x + "px";
      el.style.top = p.y + "px";
      el.style.width = p.w + "px";
      el.style.height = p.h + "px";
      el.textContent = p.label;
      el.setAttribute("data-id", p.id);
      this.canvas.appendChild(el);
    }
  }

  private padAt(x:number, y:number): Pad | null {
    for (let i=this.pads.length-1; i>=0; i--) {
      const p = this.pads[i];
      if (x>=p.x && y>=p.y && x<=p.x+p.w && y<=p.y+p.h) return p;
    }
    return null;
  }

  pointerDown(x:number, y:number) {
    const p = this.padAt(x,y);
    if (p) {
      this.dragging = p;
      this.dragOff.x = x - p.x;
      this.dragOff.y = y - p.y;
    }
    return p;
  }

  pointerMove(x:number, y:number) {
    if (!this.dragging) return;
    const p = this.dragging;
    p.x = Math.max(0, Math.min(this.canvas.clientWidth  - p.w, x - this.dragOff.x));
    p.y = Math.max(0, Math.min(this.canvas.clientHeight - p.h, y - this.dragOff.y));
    this.onChange();
  }

  pointerUp() {
    this.dragging = null;
  }
}
