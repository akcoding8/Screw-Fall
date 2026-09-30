import * as THREE from 'three';
import { getSkinDefinition, SKIN_VISUAL_ENVELOPE } from './SkinCatalog.js';

/** Render-only transforms. This class deliberately never receives Simulation,
 * collision data, a score manager, or authoritative ball position/velocity. */
export class SkinVisual {
  constructor(factory, { skinId = 'classic', palette = null } = {}) {
    this.factory = factory;
    this.root = new THREE.Group();
    this.root.name = 'cosmetic-ball';
    this.palette = palette;
    this.equip(skinId, palette);
  }

  equip(id, palette = this.palette) {
    const skin = getSkinDefinition(id);
    if (this.skin?.id === skin.id) { this.setPalette(palette); return false; }
    if (this.mesh) this.factory.release(this.mesh);
    this.skin = skin;
    this.palette = palette;
    this.mesh = this.factory.create(skin.id, palette);
    this.root.add(this.mesh);
    this.reset();
    return true;
  }

  setPalette(palette) { this.palette = palette; this.factory.setPalette(this.mesh, palette); }

  reset() {
    this.turn = 0; this.angularImpulse = 0; this.previousImpact = 0;
    this.root.scale.setScalar(1);
    this.mesh.rotation.set(...this.skin.previewOrientation);
    if (this.skin.id === 'classic') this.mesh.rotation.set(0, 0, 0);
  }

  update({ dt = 0, time = 0, impact = 0, stretch = 0, deathScale = 1, smashReady = false } = {}) {
    impact = Math.max(0, Math.min(1, impact));
    stretch = Math.max(0, Math.min(.2, stretch));
    dt = Math.max(0, Math.min(.1, Number.isFinite(dt) ? dt : 0));
    if (impact > this.previousImpact + .1) this.angularImpulse = smashReady ? .8 : .38;
    this.previousImpact = impact;
    // Exact integration of an exponentially damped angular impulse is smooth
    // at 60/120/144 Hz and has no interpolated physics state to go stale.
    const decay = Math.exp(-5 * dt);
    this.turn += this.skin.spinRate * dt + this.angularImpulse * (1 - decay) / 5;
    this.angularImpulse *= decay;
    if (this.skin.id !== 'classic') {
      this.mesh.rotation.set(this.skin.previewOrientation[0] + this.turn * .24,
        this.skin.previewOrientation[1] + this.turn, this.skin.previewOrientation[2] + this.turn * .15);
    }
    const squash = impact * (this.skin.id === 'rubber' ? .28 : .24);
    let x = 1 + squash - stretch * .35, y = 1 - squash + stretch, z = x;
    if (this.skin.id === 'jelly') {
      const wobble = Math.sin(time * 8) * .024 * (.25 + impact);
      x += wobble; z -= wobble; y += Math.sin(time * 6) * .014;
    }
    const cap = Math.min(1, SKIN_VISUAL_ENVELOPE / (this.mesh.userData.visualRadius * Math.max(x, y, z)));
    const scale = Math.max(.01, Math.min(1, Number.isFinite(deathScale) ? deathScale : 1)) * cap;
    this.root.scale.set(x * scale, y * scale, z * scale);
    this.factory.setEmissive(this.mesh, smashReady);
    this.factory.updateSurface(this.mesh, time);
  }

  dispose() { this.factory.release(this.mesh); this.root.removeFromParent(); }
}
