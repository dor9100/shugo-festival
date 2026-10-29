// Room-clock estimate from ping/pong samples: offset = median of the 5 lowest-RTT samples (recent window).
const WINDOW = 30;
const BEST = 5;

export class ClockSync {
  constructor() {
    this.offset = 0; // roomTime = localTime + offset
    this.rtt = 0; // smoothed
    this.samples = [];
  }

  /** Rough first guess from a message stamped with room time (ignores latency). */
  seed(roomNow, localNow) {
    if (!this.samples.length) this.offset = roomNow - localNow;
  }

  /** c = local send time, s = room time at reply, t = local receive time */
  sample(c, s, t) {
    const rtt = t - c;
    if (!(rtt >= 0)) return;
    this.samples.push({ rtt, off: s + rtt / 2 - t });
    if (this.samples.length > WINDOW) this.samples.shift();
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, BEST);
    const offs = best.map((x) => x.off).sort((a, b) => a - b);
    this.offset = offs[offs.length >> 1];
    this.rtt = this.samples.length === 1 ? rtt : this.rtt * 0.8 + rtt * 0.2;
  }
}
