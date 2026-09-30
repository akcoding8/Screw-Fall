export const PURCHASE_CELEBRATIONS = Object.freeze({
  standard: Object.freeze({ count: 16, duration: .64, reach: 74 }),
  premium: Object.freeze({ count: 24, duration: .80, reach: 94 }),
  gold: Object.freeze({ count: 32, duration: .94, reach: 106 }),
});

/** One small shop canvas, driven by the existing preview loop. No timers,
 * extra WebGL context, layout reads, or per-frame particle allocations. */
export class PurchaseCelebration {
  constructor(canvas, { reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false } = {}) {
    this.canvas = canvas;
    this.context = canvas?.getContext?.('2d') || null;
    this.reducedMotion = reducedMotion;
    this.particles = Array.from({ length: 32 }, () => ({ x: 0, y: 0, vx: 0, vy: 0, angle: 0, spin: 0, size: 0, color: '' }));
    this.elapsed = 0; this.duration = 0; this.count = 0; this.active = false;
  }

  start(skin) {
    this.kind = skin.id === 'auric-gold' ? 'gold' : skin.tier === 'premium' ? 'premium' : 'standard';
    const profile = PURCHASE_CELEBRATIONS[this.kind];
    this.duration = this.reducedMotion ? .5 : profile.duration;
    this.count = this.reducedMotion ? 8 : profile.count;
    this.elapsed = 0; this.active = true;
    if (this.canvas) this.canvas.hidden = false;
    const colors = skin.effects.palette;
    for (let index = 0; index < this.count; index++) {
      const particle = this.particles[index], angle = -Math.PI * (.12 + .76 * index / (this.count - 1));
      const reach = profile.reach * (.65 + (index * 7 % 11) / 25);
      particle.x = 220 + Math.cos(angle) * (this.reducedMotion ? reach : 12);
      particle.y = 118 + Math.sin(angle) * (this.reducedMotion ? reach * .5 : 8);
      particle.vx = Math.cos(angle) * reach * 1.4;
      particle.vy = Math.sin(angle) * reach * 1.8;
      particle.angle = index * 2.4; particle.spin = index % 2 ? 3 : -3;
      particle.size = this.kind === 'gold' && index % 4 === 0 ? 2 : 3.2;
      particle.color = colors[index % colors.length];
    }
    this.draw();
  }

  update(dt) {
    if (!this.active) return;
    dt = Math.max(0, Number.isFinite(dt) ? dt : 0);
    this.elapsed += dt;
    if (this.elapsed >= this.duration) { this.clear(); return; }
    if (!this.reducedMotion) for (let i = 0; i < this.count; i++) {
      const p = this.particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 180 * dt; p.angle += p.spin * dt;
    }
    this.draw();
  }

  draw() {
    const ctx = this.context;
    if (!ctx) return;
    ctx.clearRect(0, 0, 440, 180);
    ctx.globalAlpha = Math.min(1, (1 - this.elapsed / this.duration) * 2.8) * .9;
    for (let i = 0; i < this.count; i++) {
      const p = this.particles[i];
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
      ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size, p.size, p.size * 2);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  clear() { this.active = false; this.count = 0; if (this.canvas) this.canvas.hidden = true; this.context?.clearRect(0, 0, 440, 180); }
  dispose() { this.clear(); this.context = null; }
}
