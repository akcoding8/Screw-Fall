import * as THREE from 'three';
import { SkinMeshFactory } from './SkinMeshFactory.js';
import { SkinVisual } from './SkinVisual.js';
import { getSkinDefinition, SKIN_CATALOG } from './SkinCatalog.js';

export const SKIN_PREVIEW_LIMITS = Object.freeze({ width: 256, height: 192, framesPerSecond: 30, thumbnailWidth: 96, thumbnailHeight: 72 });

function placeholder(skin) {
  // Original, local fallback if WebGL/canvas export is unavailable. No network,
  // OffscreenCanvas or image-bitmap API is required by the normal path either.
  const colors = skin.material.colors;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="72" viewBox="0 0 96 72"><ellipse cx="48" cy="60" rx="21" ry="4" fill="#263b4b" opacity=".12"/><circle cx="48" cy="33" r="24" fill="${colors[0]}" stroke="#263b4b" stroke-width="1.5"/><path d="M48 9a24 24 0 0 1 0 48Z" fill="${colors[1] || colors[0]}"/><ellipse cx="40" cy="23" rx="9" ry="5" fill="#ffffff" opacity=".30"/></svg>`)}`;
}

/** One lazy preview context for the whole shop, reused across every open and
 * thumbnail. Closed shops do not render. A separate factory isolates shared
 * preview material highlights from the gameplay ball's smash-ready state. */
export class SkinPreviewRenderer {
  constructor({ canvas, factory = null, palette = null, onThumbnail = () => {}, rendererFactory = options => new THREE.WebGLRenderer(options) }) {
    this.canvas = canvas;
    this.factory = factory || new SkinMeshFactory();
    this.ownsFactory = !factory;
    this.palette = palette;
    this.onThumbnail = onThumbnail;
    this.rendererFactory = rendererFactory;
    this.cache = new Map();
    this.fallbacks = new Map();
    this.pending = [];
    this.selectedId = 'classic';
    this.active = false;
    this.time = 0;
    this.frameElapsed = 0;
    this.failed = false;
    this.disposed = false;
  }

  initialize() {
    if (this.renderer || this.failed || this.disposed) return;
    try {
      this.renderer = this.rendererFactory({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(SKIN_PREVIEW_LIMITS.width, SKIN_PREVIEW_LIMITS.height, false);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.1;
      this.scene = new THREE.Scene();
      this.scene.add(new THREE.HemisphereLight(0xffffff, 0x52675e, 1.8));
      const key = new THREE.DirectionalLight(0xfff7e8, 2.1);
      key.position.set(-3, 5, 4); this.scene.add(key);
      const rim = new THREE.DirectionalLight(0xffffff, .7);
      rim.position.set(4, 3, -4); this.scene.add(rim);
      this.camera = new THREE.PerspectiveCamera(35, SKIN_PREVIEW_LIMITS.width / SKIN_PREVIEW_LIMITS.height, .1, 10);
      this.camera.position.set(0, .65, 2.0); this.camera.lookAt(0, -.03, 0);
      this.visual = new SkinVisual(this.factory, { skinId: this.selectedId, palette: this.palette });
      this.scene.add(this.visual.root);
      this.effectGeometries = [new THREE.CircleGeometry(.56, 40), new THREE.CircleGeometry(.26, 20), new THREE.SphereGeometry(.021, 6, 4)];
      this.effectMaterials = [];
      const material = options => { const result = new THREE.MeshBasicMaterial(options); this.effectMaterials.push(result); return result; };
      this.floor = new THREE.Mesh(this.effectGeometries[0], material({ color: this.palette?.safe || '#728f8a', transparent: true, opacity: .20, depthWrite: false }));
      this.floor.rotation.x = -Math.PI / 2; this.floor.position.y = -.315; this.scene.add(this.floor);
      this.paint = Array.from({ length: 3 }, (_, index) => {
        const mesh = new THREE.Mesh(this.effectGeometries[1], material({ transparent: true, opacity: .4, depthWrite: false }));
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set((index - 1) * .18, -.310 + index * .0004, Math.sin(index * 3) * .10);
        mesh.scale.set(1, .82, 1);
        this.scene.add(mesh); return mesh;
      });
      this.dots = Array.from({ length: 6 }, () => {
        const mesh = new THREE.Mesh(this.effectGeometries[2], material({ transparent: true, opacity: .55, depthWrite: false }));
        this.scene.add(mesh); return mesh;
      });
    } catch {
      this.failed = true;
      this.renderer?.dispose();
      this.renderer = null;
    }
  }

  cacheKey(id) {
    const skin = getSkinDefinition(id);
    return `${skin.id}:${skin.paletteAdaptive ? this.palette?.ball || 'default' : 'fixed'}`;
  }

  thumbnail(id) {
    const skin = getSkinDefinition(id), key = this.cacheKey(skin.id);
    if (this.cache.has(key)) return this.cache.get(key);
    if (!this.fallbacks.has(skin.id)) this.fallbacks.set(skin.id, placeholder(skin));
    return this.fallbacks.get(skin.id);
  }

  open(id = this.selectedId, palette = this.palette) {
    if (this.disposed) return;
    this.setPalette(palette);
    this.select(id);
    this.active = true;
    this.initialize();
    this.frameElapsed = 1 / SKIN_PREVIEW_LIMITS.framesPerSecond;
    this.pending = SKIN_CATALOG.filter(skin => !this.cache.has(this.cacheKey(skin.id))).map(skin => skin.id);
    this.update(0);
  }

  close() { this.active = false; this.pending.length = 0; this.frameElapsed = 0; }

  select(id) {
    this.selectedId = getSkinDefinition(id).id;
    this.visual?.equip(this.selectedId, this.palette);
    this.frameElapsed = 1 / SKIN_PREVIEW_LIMITS.framesPerSecond;
  }

  setPalette(palette) {
    if (this.palette?.ball !== palette?.ball) {
      // Only one adaptive thumbnail is retained, even over thousands of levels.
      for (const key of this.cache.keys()) if (key.startsWith('classic:')) this.cache.delete(key);
    }
    this.palette = palette;
    this.visual?.setPalette(palette);
    this.floor?.material.color.set(palette?.safe || '#728f8a');
  }

  pose(id, time, thumbnail = false) {
    const skin = getSkinDefinition(id);
    this.visual.equip(skin.id, this.palette);
    this.visual.update({ time, dt: 0, impact: 0, stretch: 0 });
    this.visual.mesh.rotation.set(skin.previewOrientation[0], skin.previewOrientation[1] + time * skin.previewSpinRate, skin.previewOrientation[2]);
    this.visual.root.position.y = thumbnail ? .015 : .015 + Math.sin(time * 2) * .018;
    const effects = skin.effects;
    for (let index = 0; index < this.paint.length; index++) {
      const mesh = this.paint[index];
      mesh.visible = Boolean(effects.paint) && index < (effects.paint === 'dual' ? 2 : 3);
      mesh.material.color.set(effects.palette[index % effects.palette.length]);
      mesh.material.opacity = effects.paintOpacity;
      const paintScale = effects.paintSize / .56;
      mesh.scale.set(paintScale, paintScale * .82, 1);
      mesh.position.x = (index - (effects.paint === 'dual' ? .5 : 1)) * .22 * paintScale;
    }
    for (let index = 0; index < this.dots.length; index++) {
      const mesh = this.dots[index];
      mesh.visible = effects.bounce !== 'basic' && (!effects.paint || skin.id === 'auric-gold' && index < 2) && !thumbnail;
      mesh.material.color.set(effects.palette[index % effects.palette.length]);
      const phase = time * .7 + index * Math.PI / 3;
      mesh.position.set(Math.cos(phase) * .34, -.13 + Math.sin(phase * 2) * .06, Math.sin(phase) * .16);
      mesh.material.opacity = .2 + Math.max(0, Math.sin(phase + time)) * .35;
    }
  }

  update(dt) {
    if (!this.active || this.disposed || !this.renderer || this.failed) return false;
    dt = Math.max(0, Math.min(.1, Number.isFinite(dt) ? dt : 0));
    this.time += dt; this.frameElapsed += dt;
    if (this.frameElapsed + 1e-9 < 1 / SKIN_PREVIEW_LIMITS.framesPerSecond) return false;
    this.frameElapsed %= 1 / SKIN_PREVIEW_LIMITS.framesPerSecond;
    // Generate at most one thumbnail per preview frame. Real geometry is reused
    // and the live selected skin is restored before the frame reaches the user.
    const id = this.pending.shift();
    if (id) {
      this.pose(id, .65, true);
      this.renderer.setSize(SKIN_PREVIEW_LIMITS.thumbnailWidth, SKIN_PREVIEW_LIMITS.thumbnailHeight, false);
      this.renderer.render(this.scene, this.camera);
      let url;
      try { url = this.canvas.toDataURL('image/png'); } catch { url = this.thumbnail(id); }
      this.cache.set(this.cacheKey(id), url);
      this.onThumbnail(id, url);
      this.renderer.setSize(SKIN_PREVIEW_LIMITS.width, SKIN_PREVIEW_LIMITS.height, false);
    }
    this.pose(this.selectedId, this.time);
    this.renderer.render(this.scene, this.camera);
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.close(); this.disposed = true;
    this.visual?.dispose();
    for (const geometry of this.effectGeometries || []) geometry.dispose();
    for (const material of this.effectMaterials || []) material.dispose();
    this.renderer?.dispose();
    if (this.ownsFactory) this.factory.dispose();
    this.cache.clear(); this.fallbacks.clear();
  }
}
