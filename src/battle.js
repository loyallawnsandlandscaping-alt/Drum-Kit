export class Battle {
  constructor(sendFn, ui) {
    this.send = sendFn;
    this.ui = ui;
    this.you = 0;
    this.opp = 0;
    this.len = 30;
    this.timer = null;
    this.endAt = 0;
    this.active = false;
  }
  connected() {
    this.ui.status("connected");
  }
  ring() {
    this.ui.status("ringing…");
  }
  start() {
    this.you = 0; this.opp = 0;
    this.active = false;
    this.ui.setScores(this.you, this.opp);
    let c = 3;
    this.ui.timer(c.toString());
    const cd = setInterval(() => {
      c -= 1;
      if (c <= 0) {
        clearInterval(cd);
        this.active = true;
        this.endAt = performance.now() + this.len * 1000;
        this.loop();
      } else {
        this.ui.timer(c.toString());
      }
    }, 1000);
  }
  loop() {
    if (!this.active) return;
    const rem = Math.max(0, Math.ceil((this.endAt - performance.now()) / 1000));
    this.ui.timer(rem.toString());
    if (rem <= 0) {
      this.active = false;
      this.ui.timer("done");
      return;
    }
    requestAnimationFrame(() => this.loop());
  }
  localHit() {
    if (!this.active) return;
    this.you += 1;
    this.ui.setScores(this.you, this.opp);
    this.send({ t: "hit" });
  }
  remoteData(obj) {
    if (obj.t === "hit") {
      if (!this.active) return;
      this.opp += 1;
      this.ui.setScores(this.you, this.opp);
    }
  }
}
