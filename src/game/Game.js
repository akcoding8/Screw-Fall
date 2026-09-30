import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Simulation, STATES } from './Simulation.js';
import { InputController } from './InputController.js';
import { SettingsController } from './SettingsController.js';
import { CameraRig } from './CameraRig.js';
import { ViewportObserver } from './Viewport.js';
import { SaveManager } from './SaveManager.js';
import { SoundManager } from './SoundManager.js';
import { createPlatform, disposePlatform, updatePlatformView, setPlatformPalette, updateHazardMaterials } from './Platform.js';
import { ParticleSystem } from './ParticleSystem.js';
import { selectPalette } from './PaletteManager.js';
import { VISUAL_CONFIG } from './VisualConfig.js';
import { DebugGeometry } from './DebugGeometry.js';
import { NORMAL_GENERATOR_VERSION, FLOW_GENERATOR_VERSION } from './LevelGenerator.js';
import { FrameClock } from './FrameClock.js';
import { FrameDiagnostics } from './FrameDiagnostics.js';
import { RenderTimeline } from './RenderTimeline.js';
import { evaluatePlatformRenderMotion } from './PlatformMotion.js';
import { classifySegmentsAtAngle } from './HazardCollision.js';
import { normalizeAngle } from './math.js';
import { GENERATION } from './GenerationConfig.js';
import { pincerOpeningMetrics } from './PincerGeometry.js';
import { createFlowController } from './FlowFeasibility.js';
import { DebugFlowView } from './DebugFlowView.js';
import { ScoringManager } from './ScoringManager.js';
import { SkinManager } from './SkinManager.js';
import { SkinMeshFactory } from './SkinMeshFactory.js';
import { SkinVisual } from './SkinVisual.js';
import { CosmeticEffectManager } from './CosmeticEffectManager.js';
import { ScoreHUD } from './ScoreHUD.js';
import { SkinShopPanel } from './SkinShopPanel.js';
import { ProgressionDebug } from './ProgressionDebug.js';
import { ProgressManager } from './ProgressManager.js';
import { ProgressPanel } from './ProgressPanel.js';
import { EvidenceImageStore, SessionEvidenceStore } from './EvidenceImageStore.js';
import { EvidenceViewer } from './EvidenceViewer.js';
import { formatScore } from './ScoreFormatter.js';
import { levelLabel } from './LevelLabel.js';
import { SKIN_CATALOG } from './SkinCatalog.js';
import { getBritishPalette, applyBritishColumnMaterial, getBritishFlagTexture, disposeBritishMilestoneTextures } from './BritishMilestoneTheme.js';

const SOUND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4Z"/><path d="M15 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14"/></svg>';
const MUTED_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4Z"/><path d="m16 9 5 6m0-6-5 6"/></svg>';

/** Rendering/input/audio adapter. The Simulation owns every gameplay decision. */
export class Game {
  constructor(element) {
    this.element = element;
    this.canvas = element.querySelector('canvas');
    this.ui = Object.fromEntries(['level','flow-label','mute','settings-toggle','settings-panel','sensitivity-slider','sensitivity-value','palette-style','settings-done','progress','message','message-title','message-detail','tutorial-gesture','energy','rotate-device','debug','debug-info','debug-controls','debug-flow-controls','debug-flow-graph','reset-progress'].map(id => [id, element.querySelector(`#${id}`)]));
    this.save = new SaveManager();
    this.settings = this.save.load();
    this.scoring = new ScoringManager({ save: this.save, onEvent: event => {
      this.scoreHUD?.onEvent(event); this.progressionDebug?.record(event);
    } });
    this.progress = new ProgressManager({ scoring: this.scoring });
    this.skins = new SkinManager({ scoring: this.scoring, onChange: () => this.equipSkin() });
    this.scoreHUD = new ScoreHUD(element, this.scoring);
    this.sound = new SoundManager(this.settings.muted);
    this.debugEnabled = new URLSearchParams(location.search).get('debug') === '1';
    this.simulation = new Simulation({ levelNumber: this.progress.currentLevel, paletteStyle: this.settings.paletteStyle,
      debugEnabled: this.debugEnabled, resolveNextLevel: number => this.resolveNextLevel(number) });
    this.simulation.onEvent = event => this.onGameEvent(event);
    this.scene = new THREE.Scene();
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: CONFIG.renderer.antialias, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.renderer.pixelRatioLimit));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fieldOfView, 1, .1, 140);
    this.cameraRig = new CameraRig(this.camera);
    this.clock = new FrameClock();
    this.timeline = new RenderTimeline();
    this.frameDiagnostics = this.debugEnabled ? new FrameDiagnostics() : null;
    this.renderInterpolated = true;
    this.fixedUpdate = this.fixedUpdate.bind(this);
    this.effectPosition = new THREE.Vector3();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x52675e, 1.8));
    const key = new THREE.DirectionalLight(0xfff7e8, 2.1);
    key.position.set(-5, 9, 7);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, .7);
    rim.position.set(4, 3, -4);
    this.scene.add(rim);
    this.particles = new ParticleSystem(this.scene);
    this.cosmetics = new CosmeticEffectManager(this.scene);
    this.platformViews = new Map();
    this.skinFactory = new SkinMeshFactory();
    this.skinVisual = new SkinVisual(this.skinFactory, { skinId: this.skins.selectedSkinId, palette: this.simulation.level.palette });
    this.skinRenderState = { dt: 0, time: 0, impact: 0, stretch: 0, deathScale: 1, smashReady: false };
    this.ball = this.skinVisual.root;
    this.ball.position.set(Math.cos(CONFIG.world.ballWorldAngle) * CONFIG.world.ballOrbitRadius, 0, Math.sin(CONFIG.world.ballWorldAngle) * CONFIG.world.ballOrbitRadius);
    this.scene.add(this.ball);
    this.energyRing = new THREE.Mesh(new THREE.TorusGeometry(CONFIG.physics.ballRadius * 1.48, CONFIG.physics.ballRadius * .076, 6, 40), new THREE.MeshBasicMaterial({ color: 0xffdb8b, transparent: true, opacity: .85 }));
    this.energyRing.rotation.x = Math.PI / 2;
    this.scene.add(this.energyRing);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(CONFIG.physics.ballRadius * 1.24, 24), new THREE.MeshBasicMaterial({ color: 0x183d35, transparent: true, opacity: .16, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.shadow);
    const trailGeometry = new THREE.SphereGeometry(CONFIG.physics.ballRadius * .56, 8, 6);
    this.trail = Array.from({ length: 9 }, (_, i) => {
      const dot = new THREE.Mesh(trailGeometry, new THREE.MeshBasicMaterial({ color: 0xffdda5, transparent: true, opacity: (1 - i / 9) * .24, depthWrite: false }));
      dot.visible = false;
      this.scene.add(dot);
      return dot;
    });
    this.input = new InputController(this.canvas, {
      // Pointer rotation is immediate and never passes through interpolation.
      onRotate: delta => this.simulation.rotate(delta),
      onTap: () => this.simulation.retry(),
      onInteract: () => this.sound.unlock(),
      canRotate: () => !this.paused && !(this.debugEnabled && this.flowReplay) && [STATES.HOLDING, STATES.ACTIVE].includes(this.simulation.state),
      canRetry: () => !this.paused && this.simulation.state === STATES.DEAD_WAITING,
      getWidth: () => this.width,
      getSensitivityMultiplier: () => this.settings.sensitivityMultiplier,
    });
    this.lastTime = null;
    this.lastDiagnosticTime = null;
    this.elapsed = 0;
    this.debugElapsed = 0;
    this.impact = 0;
    this.cameraPulse = 0;
    this.paused = false;
    this.settingsController = new SettingsController({
      dialog: this.ui['settings-panel'],
      trigger: this.ui['settings-toggle'],
      slider: this.ui['sensitivity-slider'],
      value: this.ui['sensitivity-value'],
      done: this.ui['settings-done'],
      paletteSelect: this.ui['palette-style'],
      getPaletteStyle: () => this.settings.paletteStyle,
      onPaletteStyleChange: paletteStyle => {
        this.settings.paletteStyle = paletteStyle;
        this.simulation.paletteStyle = paletteStyle;
        this.save.save({ paletteStyle });
        this.applyPalette(this.simulation.level.kind === 'british-milestone'
          ? getBritishPalette(this.simulation.levelNumber, paletteStyle) : selectPalette(this.simulation.levelNumber, paletteStyle));
      },
      input: this.input,
      getMultiplier: () => this.settings.sensitivityMultiplier,
      onMultiplierChange: sensitivityMultiplier => {
        this.settings.sensitivityMultiplier = sensitivityMultiplier;
        this.save.save({ sensitivityMultiplier });
      },
      onOpenChange: open => { this.updatePause(); if (open) this.refreshSettingsStats(); else this.scoring.flush(); this.pwa?.refreshSafety(); },
      canOpen: () => !document.hidden && !this.contextLost && [STATES.HOLDING, STATES.DEAD_WAITING].includes(this.simulation.state),
    });
    this.skinShop = new SkinShopPanel({ element, input: this.input, skins: this.skins, scoring: this.scoring,
      getPalette: () => this.simulation.level.palette,
      canOpen: () => !document.hidden && !this.contextLost && this.simulation.state === STATES.HOLDING && !this.settingsController.isOpen,
      onOpenChange: open => { this.updatePause(); if (!open) this.scoring.flush(); this.pwa?.refreshSafety(); },
      onPurchase: skin => { this.sound.unlock().then(() => this.sound.play(skin.id === 'auric-gold' ? 'purchaseGold' : skin.tier === 'premium' ? 'purchasePremium' : 'purchase')); },
    });
    this.evidenceStore = new EvidenceImageStore({ onActivityChange: () => this.pwa?.refreshSafety() });
    this.sessionEvidence = new SessionEvidenceStore({ fallback: this.evidenceStore, onActivityChange: () => this.pwa?.refreshSafety() });
    // Debug mutations share the scoring fork, including their screenshot blobs.
    this.activeEvidenceStore = Object.fromEntries(['put', 'get', 'delete', 'count', 'getMetadata', 'listMetadata'].map(method =>
      [method, (...args) => (this.scoring.eligible ? this.evidenceStore : this.sessionEvidence)[method](...args)]));
    this.evidenceStore.count().catch(() => {});
    this.evidenceViewer = new EvidenceViewer({ dialog: element.querySelector('#evidence-viewer'), input: this.input,
      store: this.activeEvidenceStore, canOpen: () => this.progressPanel?.isOpen && !document.hidden,
      onOpenChange: () => { this.updatePause(); this.pwa?.refreshSafety(); } });
    this.progressPanel = new ProgressPanel({ element, progress: this.progress, input: this.input,
      store: this.activeEvidenceStore, viewer: this.evidenceViewer,
      getStore: () => this.scoring.eligible ? this.evidenceStore : this.sessionEvidence,
      canOpen: () => this.settingsController.isOpen && !document.hidden && !this.contextLost
        && [STATES.HOLDING, STATES.DEAD_WAITING].includes(this.simulation.state),
      onOpenChange: () => { this.updatePause(); this.refreshSettingsStats(); this.pwa?.refreshSafety(); },
      onActivityChange: () => this.pwa?.refreshSafety(),
      onChange: () => this.applyImportedProgress() });
    this.onShowTutorial = () => {
      this.settings.hintSeen = false;
      this.save.save({ hintSeen: false });
      this.updateState(); this.settingsController.close();
    };
    element.querySelector('#show-tutorial').addEventListener('click', this.onShowTutorial);
    this.trailElapsed = 0;
    this.ui.debug.hidden = !this.debugEnabled;
    this.debugBrowsing = false;
    this.routeVisible = false;
    this.setupDebug();
    if (this.debugEnabled) this.progressionDebug = new ProgressionDebug(this);
    this.onMute = () => {
      this.sound.unlock();
      this.settings.muted = !this.settings.muted;
      this.sound.setMuted(this.settings.muted);
      this.save.save({ muted: this.settings.muted });
      this.updateMute();
    };
    this.onReset = () => {
      this.evidenceStore.clear().catch(() => {});
      this.sessionEvidence.clear();
      this.settings = this.save.reset();
      this.scoring.resetFromSave();
      this.scoring.markIneligible('Local progress reset · reload to score');
      this.equipSkin();
      this.debugBrowsing = false;
      this.simulation.paletteStyle = this.settings.paletteStyle;
      this.sound.setMuted(this.settings.muted);
      this.updateMute();
      this.input.invalidateGesture();
      this.simulation.loadLevel(1);
    };
    this.ui.mute.addEventListener('click', this.onMute);
    this.ui['reset-progress'].addEventListener('click', this.onReset);
    this.onVisibility = () => { if (document.hidden) this.clearCosmeticTrails(); this.updatePause(); };
    this.onContextLost = event => {
      event.preventDefault();
      this.contextLost = true;
      this.updatePause();
      this.pwa?.refreshSafety();
      element.querySelector('#error-detail').textContent = 'The 3D view was interrupted. Reload to return to your current game level.';
      element.querySelector('#error').hidden = false;
    };
    document.addEventListener('visibilitychange', this.onVisibility);
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.viewportObserver = new ViewportObserver(element, () => this.resize());
    this.buildLevel();
    this.updateMute();
    this.resize();
    this.frame = this.frame.bind(this);
    this.frameId = requestAnimationFrame(this.frame);
  }

  applyPalette(palette, recolorPlatforms = true) {
    this.simulation.level.palette = palette;
    this.simulation.level.paletteId = palette.id;
    this.element.style.setProperty('--back', palette.background);
    this.element.style.setProperty('--accent', palette.accent);
    this.element.style.setProperty('--panel', palette.uiBackground || palette.background);
    this.scene.fog?.color.set(palette.background);
    this.column?.material.color.set(palette.column);
    if (this.column && palette.milestone) applyBritishColumnMaterial(this.column.material, palette);
    if (this.milestoneFinishMark) {
      this.milestoneFinishMark.material.map = getBritishFlagTexture(palette.family, 'finish');
      this.milestoneFinishMark.material.needsUpdate = true;
    }
    this.skinVisual.setPalette(palette);
    this.skinShop?.setPalette(palette);
    this.cosmetics.setSkin(this.skinVisual.skin, palette);
    this.shadow.material.color.set(palette.ballShadow || '#183d35');
    this.energyRing.material.color.set(palette.particle || '#ffdb8b');
    for (const dot of this.trail) dot.material.color.set(palette.particle || '#ffdda5');
    if (palette.confetti) this.particles.confettiColors = palette.confetti;
    if (recolorPlatforms) for (const view of this.platformViews.values()) setPlatformPalette(view, palette);
    // A settings change is visible immediately even though gameplay is paused.
    if (this.tower && recolorPlatforms) this.renderer.render(this.scene, this.camera);
  }

  resolveNextLevel(number) {
    if (!this.scoring.eligible || this.debugBrowsing) return Math.min(Number.MAX_SAFE_INTEGER, number + 1);
    const result = this.progress.completeAttempt();
    this.settings.levelNumber = this.progress.currentLevel;
    if (result.reason === 'level-limit') this.progressLimitMessage = result.error;
    return this.progress.currentLevel;
  }

  applyImportedProgress() {
    this.input.invalidateGesture();
    this.scoring.resetDrop();
    if (this.scoring.eligible) this.settings.levelNumber = this.progress.currentLevel;
    else this.debugBrowsing = true;
    this.simulation.loadLevel(this.progress.currentLevel);
    this.refreshSettingsStats();
  }

  refreshSettingsStats() {
    const data = this.scoring.data;
    const values = { current: data.currentNoDeathScore, best: data.bestNoDeathScore,
      points: data.pointsBalance, lifetime: data.lifetimePoints, completed: data.levelsCompletedHere };
    for (const [key, value] of Object.entries(values)) this.element.querySelector(`#settings-${key}`).textContent = formatScore(value);
    this.element.querySelector('#settings-owned').textContent = `${data.ownedSkinIds.length} / ${SKIN_CATALOG.length}`;
    this.element.querySelector('#settings-premium').textContent = this.skins.premiumUnlocked ? 'Premium unlocked' : 'Unlocks at 100,000 Lifetime Points';
    this.element.querySelector('#settings-progress-summary').textContent = `Level ${levelLabel(this.progress.currentLevel).text} · ${formatScore(data.levelsCompletedHere)} completed here`;
  }

  clearMilestoneDecoration() {
    if (!this.milestoneFinishMark) return;
    this.milestoneFinishMark.removeFromParent();
    this.milestoneFinishMark.geometry.dispose(); this.milestoneFinishMark.material.dispose();
    this.milestoneFinishMark = null;
  }

  equipSkin() {
    if (!this.skinVisual) return;
    this.skinVisual.equip(this.skins.selectedSkinId, this.simulation.level.palette);
    if (this.progressionDebug) this.progressionDebug.select.value = this.skins.selectedSkinId;
    this.cosmetics.setSkin(this.skinVisual.skin, this.simulation.level.palette);
    this.clearCosmeticTrails();
    this.scoreHUD.refresh();
    if (this.tower) this.renderer.render(this.scene, this.camera);
  }

  clearCosmeticTrails() {
    this.cosmetics?.clearTransient();
    this.trailElapsed = 0;
    for (const dot of this.trail || []) dot.visible = false;
  }

  setupDebug() {
    if (!this.debugEnabled) return;
    this.debugLayerVisibility = {};
    this.viewportGuide = document.createElement('div');
    this.viewportGuide.className = 'debug-viewport';
    this.viewportGuide.hidden = true;
    this.viewportGuide.setAttribute('aria-hidden', 'true');
    this.viewportGuide.innerHTML = '<div class="debug-safe-rect"></div><div class="debug-header-edge"></div><div class="debug-contact-guide"><span>Contact target · 43%</span></div>';
    this.element.append(this.viewportGuide);
    this.onDebugPointer = event => { this.input.blockPointer(event.pointerId); event.stopPropagation(); };
    this.onDebugClick = event => {
      const button = event.target.closest('button[data-debug]');
      if (!button) return;
      event.stopPropagation();
      this.input.invalidateGesture();
      const sim = this.simulation;
      switch (button.dataset.debug) {
        case 'guides':
          this.viewportGuide.hidden = !this.viewportGuide.hidden;
          this.updateViewportGuide();
          button.setAttribute('aria-pressed', String(!this.viewportGuide.hidden));
          break;
        case 'drops': case 'gaps': case 'footprint': case 'hazards': case 'walls': {
          const visible = this.debugGeometry?.toggle(button.dataset.debug) || false;
          this.debugLayerVisibility[button.dataset.debug] = visible;
          button.setAttribute('aria-pressed', String(visible));
          break;
        }
        case 'jump': {
          const number = Number(this.element.querySelector('#debug-level').value);
          if (Number.isSafeInteger(number) && number > 0) this.loadDebugLevel(number);
          break;
        }
        case 'previous': this.loadDebugLevel(Math.max(1, sim.levelNumber - 1)); break;
        case 'next': this.loadDebugLevel(Math.min(Number.MAX_SAFE_INTEGER, sim.levelNumber + 1)); break;
        case 'flow': {
          let next = sim.levelNumber + 10 - sim.levelNumber % 10;
          if (next % 100 === 0) next += 10;
          this.loadDebugLevel(Math.min(Number.MAX_SAFE_INTEGER, next)); break;
        }
        case 'regenerate': this.loadDebugLevel(sim.levelNumber); break;
        case 'route':
          this.routeVisible = !this.routeVisible;
          if (this.routeView) this.routeView.visible = this.routeVisible;
          button.setAttribute('aria-pressed', String(this.routeVisible));
          break;
        case 'motion':
          this.scoring?.markIneligible('Obstacle motion override');
          sim.animationPaused = !sim.animationPaused;
          this.resetMotionHistory(false);
          button.setAttribute('aria-pressed', String(sim.animationPaused));
          break;
        case 'interpolation':
          this.renderInterpolated = !this.renderInterpolated;
          button.setAttribute('aria-pressed', String(!this.renderInterpolated));
          break;
        case 'flow-ideal': this.startFlowReplay('ideal'); break;
        case 'flow-skilled': this.startFlowReplay('skilled'); break;
        case 'flow-manual': this.loadDebugLevel(sim.levelNumber); break;
        case 'flow-trajectories':
          button.setAttribute('aria-pressed', String(this.flowDebugView?.toggle() || false));
          break;
        case 'return':
          this.scoring?.markIneligible('Manual debug reset');
          this.debugBrowsing = false;
          sim.loadLevel(this.settings.levelNumber);
          break;
        default: this.progressionDebug?.handle(button.dataset.debug, button); break;
      }
    };
    this.ui.debug.addEventListener('pointerdown', this.onDebugPointer);
    this.ui['debug-controls'].addEventListener('click', this.onDebugClick);
    this.onDebugChange = event => {
      if (event.target.id === 'debug-skin') {
        this.input.invalidateGesture(); this.progressionDebug?.preview(event.target.value); return;
      }
      if (event.target.id !== 'debug-speed') return;
      this.input.invalidateGesture();
      this.scoring?.markIneligible('Terminal speed override');
      this.simulation.setDebugTerminalSpeed(Number(event.target.value));
      this.ui['debug-info'].textContent = this.debugText();
    };
    this.ui['debug-controls'].addEventListener('change', this.onDebugChange);
  }

  loadDebugLevel(number) {
    if (!this.debugEnabled) return false;
    this.scoring?.markIneligible('Debug level preview');
    // Previewing numbered levels never writes their number into the saved game.
    this.debugBrowsing = true;
    this.input.invalidateGesture();
    this.simulation.loadLevel(number);
    return true;
  }

  startFlowReplay(mode) {
    if (!this.debugEnabled || this.simulation.level.kind !== 'flow' || !['ideal', 'skilled'].includes(mode)) return false;
    this.scoring?.markIneligible('Automated Flow replay');
    this.loadDebugLevel(this.simulation.levelNumber);
    this.flowReplay = { mode, controller: createFlowController(this.simulation.level, { mode, trial: 0 }), bounces: 0, finished: false };
    return true;
  }

  advanceFlowReplay(dt) {
    if (!this.debugEnabled || !this.flowReplay) return false;
    const sim = this.simulation, replay = this.flowReplay;
    // Keep a completed inspection on its finish; returning to manual reloads it.
    if (replay.finished || sim.state === STATES.COMPLETING) return true;
    if ([STATES.HOLDING, STATES.ACTIVE].includes(sim.state)) sim.rotate(replay.controller.step(dt, sim.ball.y, sim.rotation));
    return false;
  }

  updateViewportGuide() {
    if (!this.viewportGuide || !this.cameraRig.gameplayRect) return;
    const rect = this.cameraRig.gameplayRect;
    const safe = this.viewportGuide.querySelector('.debug-safe-rect');
    Object.assign(safe.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    this.viewportGuide.querySelector('.debug-contact-guide').style.top = `${this.cameraRig.contactTargetY}px`;
    this.viewportGuide.querySelector('.debug-header-edge').style.top = `${rect.headerBottom}px`;
  }

  buildRouteView() {
    if (!this.debugEnabled || !this.simulation.level.route) return;
    const vertices = [], radius = CONFIG.world.ballOrbitRadius;
    let previous = null;
    for (const route of this.simulation.level.route) {
      const y = route.y + VISUAL_CONFIG.routeHeight;
      const point = [Math.cos(route.angle) * radius, y, Math.sin(route.angle) * radius];
      if (previous) vertices.push(...previous, ...point);
      previous = point;
      for (let i = 0; i < 12; i++) {
        const a = route.angle - route.halfWidth + 2 * route.halfWidth * i / 12;
        const b = route.angle - route.halfWidth + 2 * route.halfWidth * (i + 1) / 12;
        vertices.push(Math.cos(a) * radius, y, Math.sin(a) * radius, Math.cos(b) * radius, y, Math.sin(b) * radius);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    this.routeView = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#16a9e8', transparent: true, opacity: .8, depthTest: false }));
    this.routeView.name = 'Debug intended corridor';
    this.routeView.visible = this.routeVisible;
    this.routeView.renderOrder = 4;
    this.tower.add(this.routeView);
  }

  buildLevel() {
    this.flowReplay = null;
    this.flowDebugView?.dispose();
    this.flowDebugView = null;
    this.particles.clear();
    this.cosmetics.clear();
    this.clearMilestoneDecoration();
    this.debugGeometry?.dispose();
    for (const view of this.platformViews.values()) disposePlatform(view);
    this.platformViews.clear();
    if (this.routeView) {
      this.routeView.geometry.dispose(); this.routeView.material.dispose();
      this.routeView = null;
    }
    if (this.tower) {
      this.scene.remove(this.tower);
      this.column.geometry.dispose();
      this.column.material.dispose();
    }
    const sim = this.simulation;
    this.scoring.beginAttempt(sim.level, sim.state);
    this.progress.beginAttempt(sim.level, sim.state);
    const palette = sim.level.palette;
    this.element.style.setProperty('--back', palette.background);
    this.element.style.setProperty('--accent', palette.accent);
    this.scene.fog = new THREE.Fog(palette.background, 20, 55);
    this.tower = new THREE.Group();
    this.motionViews = [];
    this.scene.add(this.tower);
    for (const platform of sim.platforms) {
      const view = createPlatform(platform, palette);
      this.platformViews.set(platform.id, view);
      this.tower.add(view);
      if (platform.motion) this.motionViews.push({ platform, view });
    }
    const bottom = sim.platforms.at(-1).y;
    const height = -bottom + 2.3;
    this.column = new THREE.Mesh(new THREE.CylinderGeometry(.57, .61, height, 48), new THREE.MeshStandardMaterial({ color: palette.column, roughness: .7 }));
    this.column.position.y = bottom + height / 2 - 1.6;
    this.tower.add(this.column);
    if (palette.milestone) {
      // Cylinder caps have radial UVs. A single navy texel avoids a tiny,
      // repeating flag pattern on the lid while reusing the side material.
      const geometry = this.column.geometry, uv = geometry.attributes.uv;
      const repeat = getBritishFlagTexture(palette.family, 'column').repeat;
      for (const group of geometry.groups) if (group.materialIndex > 0) {
        for (let i = group.start; i < group.start + group.count; i++) uv.setXY(geometry.index.getX(i), .05 / repeat.x, .25 / repeat.y);
      }
      uv.needsUpdate = true;
      this.milestoneFinishMark = new THREE.Mesh(new THREE.PlaneGeometry(1.65, .825),
        new THREE.MeshBasicMaterial({ map: getBritishFlagTexture(palette.family, 'finish'), depthWrite: false }));
      this.milestoneFinishMark.name = 'Original Union Jack finish emblem';
      this.milestoneFinishMark.rotation.x = -Math.PI / 2;
      this.milestoneFinishMark.position.set(0, .019, 1.6);
      this.platformViews.get(sim.platforms.at(-1).id).add(this.milestoneFinishMark);
    }
    this.skinVisual.reset();
    this.ball.visible = true;
    this.ball.scale.setScalar(1);
    this.ball.position.y = sim.ball.y;
    this.cameraAnchor = sim.anchorY;
    this.impact = 0;
    this.cameraPulse = 0;
    this.trailElapsed = 0;
    for (const dot of this.trail) dot.visible = false;
    const label = levelLabel(sim.levelNumber);
    this.ui.level.textContent = label.text;
    this.element.style.setProperty('--level-font-size', `${label.fontSize}px`);
    this.ui['flow-label'].hidden = sim.level.kind !== 'flow';
    this.element.querySelector('#milestone-label').hidden = sim.level.kind !== 'british-milestone';
    if (!this.debugBrowsing && this.scoring.eligible) {
      this.settings.levelNumber = this.progress.currentLevel;
    }
    this.applyPalette(palette, false);
    this.buildRouteView();
    if (this.debugEnabled) {
      this.debugGeometry = new DebugGeometry(sim.level, this.platformViews, this.tower);
      this.ui['debug-flow-controls'].hidden = sim.level.kind !== 'flow';
      this.ui['debug-controls'].querySelector('[data-debug="flow-trajectories"]').setAttribute('aria-pressed', 'false');
      if (sim.level.kind === 'flow') this.flowDebugView = new DebugFlowView(sim.level, this.tower, this.ui['debug-flow-graph']);
      for (const [name, visible] of Object.entries(this.debugLayerVisibility)) if (visible) this.debugGeometry.toggle(name);
    }
    this.updateState();
    this.updateCamera(0, true);
    this.resetMotionHistory();
    // Generation/build work must not become elapsed physics time on a freshly
    // loaded tower. Also avoid presenting its geometry with the old camera.
    this.lastTime = null;
    this.levelJustBuilt = true;
    this.renderer.render(this.scene, this.camera);
    if (this.debugEnabled) {
      this.element.querySelector('#debug-level').value = String(sim.levelNumber);
      this.ui['debug-controls'].querySelector('[data-debug="motion"]').setAttribute('aria-pressed', String(sim.animationPaused));
      this.ui['debug-info'].textContent = this.debugText();
    }
  }

  onGameEvent(event) {
    const sim = this.simulation;
    this.scoring.handleEvent(event);
    this.progress?.handleEvent(event);
    if (this.debugEnabled && this.flowReplay) {
      if (event.type === 'platformLanded' || event.type === 'platformSmashed') this.flowReplay.bounces++;
      if (event.type === 'gameLevelCompleted') this.flowReplay.finished = true;
    }
    if (event.type === 'platformLanded' || event.type === 'platformSmashed'
      || event.type === 'ceilingContact' || event.type === 'playerDied'
      || event.type === 'gameLevelCompleted') this.renderDiscontinuity = true;
    switch (event.type) {
      case 'stateChanged':
        // Invalidate at the boundary, while the old pointers are still known.
        // Loading the next tower must never turn that old drag back into input.
        if ([STATES.DEAD_ANIMATION, STATES.COMPLETING, STATES.TRANSITIONING].includes(event.state)) this.input.invalidateGesture();
        if (event.state === STATES.ACTIVE && !this.settings.hintSeen && !this.debugBrowsing && this.scoring.eligible) {
          this.settings.hintSeen = true;
          this.save.save({ hintSeen: true });
        }
        this.updateState();
        break;
      case 'levelLoaded': this.buildLevel(); break;
      case 'platformLanded':
        this.impact = 1;
        this.tower.rotation.y = sim.rotation;
        {
          const view = this.platformViews.get(event.platform.id);
          const state = event.platform.motion ? evaluatePlatformRenderMotion(event.platform, event.impactTime) : event.platform;
          updatePlatformView(view, event.platform, state);
          this.tower.updateMatrixWorld(true);
          const angle = normalizeAngle(CONFIG.world.ballWorldAngle + sim.rotation - (state.rotation ?? event.platform.baseRotation));
          this.effectPosition.set(this.ball.position.x, event.platform.y, this.ball.position.z);
          this.cosmetics.onLanding(event.platform, view, angle, this.effectPosition);
        }
        this.sound.play('bounce');
        break;
      case 'platformPassed':
        this.cosmetics.clearPlatform(event.platform.id);
        this.effectPosition.set(this.ball.position.x, event.platform.y + CONFIG.physics.ballRadius, this.ball.position.z);
        this.cosmetics.onPass(this.effectPosition);
        updatePlatformView(this.platformViews.get(event.platform.id), event.platform);
        this.tower.rotation.y = sim.rotation;
        this.tower.updateMatrixWorld(true);
        this.particles.shatter(this.platformViews.get(event.platform.id));
        this.sound.play('pass');
        break;
      case 'smashActivated':
        this.sound.play('activate');
        break;
      case 'platformSmashed':
        this.impact = 1;
        this.cosmetics.clearPlatform(event.platform.id);
        updatePlatformView(this.platformViews.get(event.platform.id), event.platform);
        this.tower.rotation.y = sim.rotation;
        this.tower.updateMatrixWorld(true);
        this.effectPosition.set(this.ball.position.x,
          event.wallTop ? sim.ball.y - CONFIG.physics.ballRadius : event.platform.y, this.ball.position.z);
        this.cosmetics.onSmash(this.effectPosition);
        this.particles.shatter(this.platformViews.get(event.platform.id), true,
          this.cosmetics.profile?.paint ? this.cosmetics.profile.palette : null);
        this.effectPosition.y += .15;
        this.particles.burst(this.effectPosition, sim.level.palette.ball, CONFIG.particles.smashCount, 'impact');
        this.sound.play('smash');
        this.cameraPulse = CONFIG.camera.smashStrength;
        break;
      case 'playerDied':
        this.clearCosmeticTrails();
        this.cosmetics.onDeath();
        this.effectPosition.set(this.ball.position.x, sim.ball.y, this.ball.position.z);
        this.particles.burst(this.effectPosition, sim.level.palette.hazard, CONFIG.particles.deathCount, 'death');
        this.sound.play('death');
        this.cameraPulse = CONFIG.camera.impactStrength;
        break;
      case 'gameLevelCompleted':
        this.clearCosmeticTrails();
        this.effectPosition.set(0, event.platform.y + .15, 0);
        this.particles.burst(this.effectPosition, sim.level.palette.finish, CONFIG.particles.confettiCount, 'complete');
        this.sound.play('complete');
        this.impact = 1;
        break;
    }
    this.scoreHUD.refresh();
    // A lethal wall may be encountered directly in a pointer event between
    // physics ticks. Snap its resolved contact immediately, not one tick later.
    if (this.renderDiscontinuity && !this.inFixedStep) this.resetMotionHistory(false);
  }

  updateState() {
    const state = this.simulation.state;
    this.element.dataset.state = state;
    this.ui['settings-toggle'].hidden = ![STATES.HOLDING, STATES.DEAD_WAITING].includes(state);
    this.ui['settings-toggle'].disabled = this.ui['settings-toggle'].hidden;
    const skinsButton = this.element.querySelector('#skins-toggle');
    skinsButton.hidden = state !== STATES.HOLDING;
    skinsButton.disabled = skinsButton.hidden;
    this.scoreHUD.setState(state);
    const messages = {
      HOLDING: this.settings.hintSeen ? ['', ''] : ['Drag to rotate', 'Move left or right to find a gap.'],
      DEAD_ANIMATION: ['', ''],
      DEAD_WAITING: ['Tap to retry', ''],
      COMPLETING: ['Level complete', ''],
    };
    this.ui.message.classList.toggle('quiet', !messages[state]);
    const [title, detail] = messages[state] || ['', ''];
    this.ui['message-title'].textContent = title;
    this.ui['message-title'].hidden = !title;
    this.ui['message-detail'].textContent = detail;
    this.ui['message-detail'].hidden = !detail;
    this.ui['tutorial-gesture'].hidden = state !== STATES.HOLDING || this.settings.hintSeen;
    this.pwa?.refreshSafety();
  }

  updateMute() {
    this.ui.mute.innerHTML = this.settings.muted ? MUTED_ICON : SOUND_ICON;
    this.ui.mute.setAttribute('aria-label', this.settings.muted ? 'Unmute sound' : 'Mute sound');
    this.ui.mute.setAttribute('aria-pressed', String(this.settings.muted));
    this.ui.mute.title = this.settings.muted ? 'Unmute sound' : 'Mute sound';
    const status = this.element.querySelector('#sound-status');
    if (status) status.textContent = this.settings.muted ? 'Off' : 'On';
  }

  resize() {
    const layout = this.viewportObserver.measure();
    const signature = [layout.width, layout.height, layout.top, layout.right, layout.bottom, layout.left, layout.headerBottom].join(':');
    this.updatePause();
    if (signature === this.viewportSignature) return;
    const smooth = this.viewportSignature !== undefined;
    this.viewportSignature = signature;
    this.width = layout.width;
    this.height = layout.height;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.renderer.pixelRatioLimit));
    this.renderer.setSize(this.width, this.height, false);
    this.cameraRig.resize(this.width, this.height, { ...layout, smooth });
    // Keep the low-water follow position during chrome changes. Snapping it to
    // the ball here used to turn a harmless resize into a vertical camera jump.
    this.updateCamera(0);
    this.updateViewportGuide?.();
    // setSize clears the drawing buffer. A resize observer can run after this
    // frame's ordinary render, so redraw now even during active play. No physics
    // or cosmetic clock advances, and this work only runs when layout changes.
    this.renderer.render(this.scene, this.camera);
  }

  updatePause() {
    const visual = this.viewportObserver?.visualViewport;
    const landscapeTouch = matchMedia('(pointer: coarse)').matches
      && (visual?.width ?? window.innerWidth) > (visual?.height ?? window.innerHeight);
    this.ui['rotate-device'].hidden = !landscapeTouch;
    const paused = document.hidden || landscapeTouch || Boolean(this.contextLost) || Boolean(this.settingsController?.isOpen)
      || Boolean(this.skinShop?.isOpen) || Boolean(this.progressPanel?.isOpen) || Boolean(this.evidenceViewer?.isOpen)
      || Boolean(this.pwa?.promptOpen) || Boolean(this.pwaUpdating);
    if (paused !== this.paused) {
      this.paused = paused;
      this.input.setPaused(paused);
      this.resetMotionHistory();
      this.lastTime = null;
    }
  }

  updateCamera(dt, snap = false) {
    const pulse = this.cameraPulse * Math.sin(this.elapsed * 43);
    if (snap) this.cameraRig.step(this.simulation.anchorY, 0, true);
    this.cameraRig.render(snap ? this.cameraRig.simulationAnchorY : this.timeline.display.anchor, dt, pulse);
    this.cameraAnchor = this.cameraRig.anchorY;
    this.cameraPulse *= Math.exp(-12 * dt);
  }

  renderState(dt, alpha) {
    const sim = this.simulation;
    const display = this.timeline.sample(alpha, !this.debugEnabled || this.renderInterpolated);
    this.tower.rotation.y = sim.rotation;
    for (const { platform, view } of this.motionViews) {
      if (platform.active) updatePlatformView(view, platform, evaluatePlatformRenderMotion(platform, display.animationTime));
    }
    updateHazardMaterials(display.animationTime);
    const active = sim.state === STATES.ACTIVE || sim.state === STATES.HOLDING;
    const y = display.y;
    this.ball.position.y = y;
    this.debugGeometry?.update(display.animationTime, y);
    this.impact = Math.max(0, this.impact - dt * 5);
    const stretch = active && display.velocity < -12 ? Math.min(.2, -display.velocity * .005) : 0;
    this.ball.visible = sim.state !== STATES.DEAD_WAITING;
    const deathScale = sim.state === STATES.DEAD_ANIMATION ? Math.max(.01, 1 - display.stateElapsed / CONFIG.timing.deathDuration) : 1;
    const skinState = this.skinRenderState;
    skinState.dt = dt; skinState.time = display.animationTime; skinState.impact = this.impact;
    skinState.stretch = stretch; skinState.deathScale = deathScale; skinState.smashReady = sim.smashReady;
    this.skinVisual.update(skinState);
    this.energyRing.visible = sim.smashReady;
    this.energyRing.position.copy(this.ball.position);
    this.energyRing.scale.setScalar(1 + Math.sin(this.elapsed * 12) * .08);
    if (this.lastSmashReady !== sim.smashReady) {
      this.ui.energy.classList.toggle('visible', sim.smashReady);
      this.lastSmashReady = sim.smashReady;
    }
    if (this.lastProgress !== sim.progress) {
      this.ui.progress.style.transform = `scaleX(${sim.progress})`;
      this.lastProgress = sim.progress;
    }
    this.shadow.visible = false;
    for (const platform of sim.platforms) {
      if (!platform.active || platform.y > y - CONFIG.physics.ballRadius + .02) continue;
      const distance = y - platform.y;
      const state = platform.motion ? evaluatePlatformRenderMotion(platform, display.animationTime) : platform;
      const angle = normalizeAngle(CONFIG.world.ballWorldAngle + sim.rotation - (state.rotation ?? platform.baseRotation));
      if (distance < 4 && (platform.finish || classifySegmentsAtAngle(state.segments, angle) !== 'gap')) {
        this.shadow.position.set(this.ball.position.x, platform.y + .018, this.ball.position.z);
        this.shadow.material.opacity = Math.max(0, .2 - distance * .044);
        this.shadow.scale.setScalar(1 + distance * .23);
        this.shadow.visible = this.ball.visible;
      }
      break;
    }
    this.trailElapsed += dt;
    if (this.trailElapsed >= .022) {
      this.trailElapsed %= .022;
      for (let i = this.trail.length - 1; i > 0; i--) {
        this.trail[i].position.copy(this.trail[i - 1].position);
        this.trail[i].visible = this.trail[i - 1].visible;
      }
      this.trail[0].position.copy(this.ball.position);
      this.trail[0].visible = active && display.velocity < -5 && this.skinVisual.skin.id === 'classic';
    }
    for (let i = 0; i < this.trail.length; i++) this.trail[i].scale.setScalar((1 - i / this.trail.length) * (sim.smashReady ? 1.5 : .8));
    this.updateCamera(dt);
    this.particles.update(dt, this.camera);
    this.cosmetics.update(dt, this.ball.position, display.velocity, active);
    this.progressionDebug?.update(this.ball.position);
    this.scoreHUD.update(dt, this.ball.position, this.camera, this.width, this.height);
    this.debugElapsed += dt;
    if (this.debugElapsed > .25) {
      this.debugElapsed = 0;
      const percent = Math.round(sim.progress * 100);
      if (this.lastProgressPercent !== percent) {
        this.ui.progress.parentElement.setAttribute('aria-valuenow', String(percent));
        this.lastProgressPercent = percent;
      }
      if (this.debugEnabled) this.ui['debug-info'].textContent = this.debugText();
    }
    this.renderer.render(this.scene, this.camera);
  }

  debugText() {
    const sim = this.simulation, level = sim.level;
    const counts = Object.entries(level.obstacleCounts || {}).map(([type, count]) => `${type} ${count}`).join(' · ');
    const platform = sim.platforms.find(item => item.active && item.y <= sim.ball.y - CONFIG.physics.ballRadius + 1e-7) || sim.platforms.at(-1);
    const route = platform.route;
    const metrics = level.routeMetrics;
    const degrees = value => Number.isFinite(value) ? `${(value * 180 / Math.PI).toFixed(1)}°` : '—';
    const motion = platform.motion;
    const motionState = motion ? evaluatePlatformRenderMotion(platform, this.timeline.display.animationTime) : null;
    const motionDescription = !motion ? 'Static obstacle phase' : motion.type === 'breathing'
      ? `Breathing gap ${degrees(motionState.gapWidth)} · ${degrees(motion.minWidth)}–${degrees(motion.maxWidth)} · period ${motion.period.toFixed(2)} s`
      : `${motion.type} phase ${degrees(motionState.rotation - platform.baseRotation)} · speed ${motion.speed.toFixed(3)} rad/s`;
    const opening = motion?.type === 'breathing' ? pincerOpeningMetrics(motionState.gapWidth, motion.variant, motion.tipWidth) : null;
    const pincers = opening ? [
      `${motion.variant}${motion.variant === 'breathing-single-tip' ? ` ${motion.tipSide}` : ''} · phase ${degrees(motionState.phase)}`,
      `Opening ${opening.visualAngle.toFixed(3)} rad · ${opening.visualWorldWidth.toFixed(3)} world · ${opening.visualBallDiameters.toFixed(2)} ball diameters`,
      `Validated minimum ${degrees(motion.minWidth)} · physical floor ${degrees(opening.minimumAngle)} / ${opening.minimumWorldWidth.toFixed(3)} world`,
      `Nonlethal width ${opening.effectiveWorldWidth.toFixed(3)} world (inset shoulders stay solid) · pincer cost ${platform.pincerCost ?? motion.budgetCost ?? 0}`,
    ] : [];
    const wallCount = (level.obstacleCounts.lowWall || 0) + (level.obstacleCounts.divider || 0);
    const profile = GENERATION.profiles[level.difficulty];
    const wallRange = profile ? (level.wallFocused ? profile.wallFocusedCount : profile.wallCount) : [0, 0];
    const placement = level.obstaclePlacement;
    const walls = [`Walls ${wallCount} · low ${level.obstacleCounts.lowWall || 0} / tall ${level.obstacleCounts.divider || 0} · when present ${wallRange.join('–')}`,
      `Wall proposals ${placement?.proposedWalls ?? 0} · rejected ${placement?.rejectedWalls ?? 0} · ${Object.entries(placement?.wallRejectionReasons || {}).map(([reason, count]) => `${reason} ${count}`).join(', ') || 'no rejections'}`];
    const normal = metrics ? [
      `Target ${degrees(route?.angle)} · delta ${degrees(route?.delta)} · run ${route?.directionRun || 0}`,
      `Reversals ${metrics.reversals} · ${(metrics.reversalRate * 100).toFixed(1)}% · max run ${metrics.longestSameDirectionRun}`,
      `CW ${degrees(metrics.clockwiseMovement)} · CCW ${degrees(metrics.anticlockwiseMovement)}`,
      `Balance ${metrics.directionBalance.toFixed(2)} · net ${metrics.netRotationRatio.toFixed(2)}`,
      `${platform.silhouette || platform.type} · width ${platform.silhouetteMetrics?.safeWidthBallDiameters?.toFixed(2) || '—'} ball diameters`,
      `Drop ${route?.plannedDropId || 'none'} · shoulder ${platform.hazardShoulder || 'none'}`,
      `Budget ${level.difficultyBudget?.used ?? '—'}/${level.difficultyBudget?.limit ?? '—'} · platform ${platform.difficultyCost ?? 0}`,
      `Common gaps: accidental ${level.gapAlignment?.accidentalThreeCount || 0} triples · hard ${level.gapAlignment?.hardViolationCount || 0}`,
    ] : this.flowDiagnosticText(platform); 
    return [
      this.frameDiagnosticText(),
      this.progressionDebug?.text() || '',
      this.pwa ? `PWA ${this.pwa.version} (${this.pwa.build}) · ${this.pwa.manager.debugStatus}` : '',
      `${sim.state} · level ${sim.levelNumber}`,
      this.debugBrowsing ? `PREVIEW ONLY · saved ${this.settings.levelNumber}` : 'Saved progression',
      `Generator v${level.generatorVersion} · seed ${level.seed}`,
      `Normal v${NORMAL_GENERATOR_VERSION} · Flow v${FLOW_GENERATOR_VERSION}`,
      ...(level.milestone ? [`British generator v${level.milestone.generatorVersion} · theme v${level.milestone.themeVersion} · theme seed ${level.milestone.themeSeed}`] : []),
      `Slot ${level.cadenceSlot}/50 · ${level.kind} · rating ${level.difficultyRating}`,
      `${level.difficulty} · ${level.archetype}`,
      `${level.platformCount} platforms · ${level.fallback ? 'FALLBACK' : 'validated'}`,
      counts,
      `Animation ${sim.animationTime.toFixed(2)} s${sim.animationPaused ? ' (paused)' : ''}`,
      motionDescription,
      ...pincers,
      ...walls,
      `Velocity ${sim.ball.velocity.toFixed(2)} · passes ${sim.passCount}`,
      `Terminal ${sim.terminalSpeedPercent}% · cap ${sim.maxDownwardSpeed}`,
      `Contact target ${(CONFIG.camera.contactScreenAnchor * 100).toFixed(1)}% of safe viewport`,
      ...normal,
      `Smash ${sim.smashReady} · sensitivity ${this.settings.sensitivityMultiplier.toFixed(1)}×`,
      `${this.settings.paletteStyle} · ${level.palette.name}`,
      `Debris ${this.particles.activeDebrisCount}/${CONFIG.particles.maxFragments} · particles ${this.particles.activeCount - this.particles.activeDebrisCount}`,
      `Geometry ${this.renderer.info.memory.geometries} · drag sign +`,
    ].join('\n');
  }

  flowDiagnosticText(platform) {
    const level = this.simulation.level, flow = level.flow;
    if (!flow) return [];
    const config = GENERATION.flow, certificate = flow.feasibility;
    const dt = CONFIG.world.platformSpacing / CONFIG.physics.maxDownwardSpeed;
    const index = Math.min(platform.index, level.route.length - 1);
    const stepAt = i => i > 0 ? level.route[i].angle - level.route[i - 1].angle : 0;
    const rate = Math.abs(stepAt(index)) / dt;
    const curve = index > 1 ? stepAt(index) - stepAt(index - 1) : 0;
    const jerk = index > 2 ? curve - (stepAt(index - 1) - stepAt(index - 2)) : 0;
    const width = level.route[index].halfWidth * 2;
    return [
      `Flow route ${flow.rotations.toFixed(2)} turns · generator v${level.generatorVersion}`,
      `Required rate ${rate.toFixed(3)} / ${config.maxTurnSpeed} rad/s · curvature ${curve.toFixed(4)} / ${config.maxCurvature.toFixed(4)} rad/platform²`,
      `Jerk ${jerk.toFixed(5)} / ${config.maxJerk} rad/platform³`,
      `Gap ${(width * 180 / Math.PI).toFixed(1)}° · ${(2 * CONFIG.world.ballOrbitRadius * Math.sin(width / 2) / (2 * CONFIG.physics.ballRadius)).toFixed(2)} ball diameters`,
      `Reaction ${config.human.reactionDelay.map(time => Math.round(time * 1000)).join('–')} ms · steering ${(CONFIG.input.sensitivity * CONFIG.input.multiplier.default * config.human.viewportSpeed).toFixed(2)} rad/s`,
      `Ideal ${certificate?.ideal?.success ? 'pass' : '—'} · skilled ${certificate?.skilled?.successes ?? '—'}/${certificate?.skilled?.trials ?? '—'} trials`,
      `Worst section ${certificate?.skilled?.worstSectionFailures ?? '—'} failed trials · threshold ${config.human.minimumSuccessRate * 100}%`,
      `Difficult platforms ${certificate?.skilled?.difficultSections.map(section => `${section.index + 1}(${section.failures})`).join(', ') || 'none'}`,
      this.flowReplay ? `REPLAY ${this.flowReplay.mode} · ${this.flowReplay.bounces} bounces · ${this.flowReplay.finished ? 'complete' : 'running'}` : 'Manual play · replay controls below',
    ];
  }

  frame(now) {
    this.frameId = requestAnimationFrame(this.frame);
    const viewportDt = this.lastViewportTime ? Math.min((now - this.lastViewportTime) / 1000, .1) : 0;
    this.lastViewportTime = now;
    if (this.skinShop && !document.hidden && !this.contextLost) this.skinShop.update(viewportDt);
    if (this.paused) {
      this.lastTime = null;
      this.lastDiagnosticTime = null;
      if (!document.hidden && this.cameraRig.updateViewport(viewportDt)) this.renderer.render(this.scene, this.camera);
      return;
    }
    const rawDt = this.lastTime === null ? 0 : Math.max(0, (now - this.lastTime) / 1000);
    const diagnosticDt = this.lastDiagnosticTime === null ? 0 : Math.max(0, (now - this.lastDiagnosticTime) / 1000);
    this.lastDiagnosticTime = now;
    this.lastTime = now;
    this.clock.advance(rawDt, this.fixedUpdate);
    const dt = this.levelJustBuilt ? 0 : this.clock.delta;
    this.levelJustBuilt = false;
    this.elapsed += dt;
    this.frameDiagnostics?.record(diagnosticDt, this.clock.substeps, this.clock.discarded);
    this.renderState(dt, this.clock.alpha);
  }

  get accumulator() { return this.clock.accumulator; }

  fixedUpdate(dt) {
    this.inFixedStep = true;
    this.timeline.beforeStep();
    if (!this.advanceFlowReplay?.(dt)) this.simulation.step(dt);
    this.cameraRig.step(this.simulation.anchorY, dt);
    this.timeline.capture(this.simulation, this.cameraRig.simulationAnchorY, this.renderDiscontinuity);
    this.renderDiscontinuity = false;
    this.inFixedStep = false;
  }

  resetMotionHistory(resetClock = true) {
    if (resetClock) this.clock.reset();
    this.timeline.capture(this.simulation, this.cameraRig.simulationAnchorY, true);
    this.renderDiscontinuity = false;
  }

  frameDiagnosticText() {
    const stats = this.frameDiagnostics;
    if (!stats) return '';
    const clock = this.clock, timeline = this.timeline;
    const distribution = Array.from(stats.substepDistribution, (count, steps) => count ? `${steps}:${count}` : '').filter(Boolean).join(' ');
    let dynamicCount = 0;
    for (const platform of this.simulation.motionPlatforms) if (platform.active) dynamicCount++;
    return [
      `Motion ${this.renderInterpolated ? 'INTERPOLATED' : 'RAW'} · rAF ≈${stats.estimatedHz.toFixed(1)} Hz · ${stats.fps.toFixed(1)} FPS`,
      `Frame ${stats.instantMs.toFixed(2)} ms · mean ${stats.averageMs.toFixed(2)} · p50 ${stats.p50.toFixed(2)}`,
      `p95 ${stats.p95.toFixed(2)} ms · p99 ${stats.p99.toFixed(2)} · long ${stats.longFrames}`,
      `Fixed ${(clock.fixedStep * 1000).toFixed(3)} ms · steps ${clock.substeps} · rolling [${distribution}]`,
      `Accumulator ${(clock.accumulator * 1000).toFixed(3)} ms · α ${clock.alpha.toFixed(3)}`,
      `Discarded ${(stats.discardedSeconds * 1000).toFixed(1)} ms · zero ${stats.zeroFrames} · multi ${stats.multiFrames}`,
      `Ball prev ${timeline.previous.y.toFixed(4)} · sim ${timeline.current.y.toFixed(4)} · render ${timeline.display.y.toFixed(4)}`,
      `Camera sim ${this.cameraRig.simulationAnchorY.toFixed(4)} · render ${this.cameraRig.anchorY.toFixed(4)}`,
      `Motion ${dynamicCount} active · ${this.renderer.info.render.calls} draws · ${this.renderer.info.render.triangles} triangles`,
    ].join('\n');
  }

  dispose() {
    cancelAnimationFrame(this.frameId);
    this.pwa?.dispose();
    this.flowDebugView?.dispose();
    this.flowReplay = null;
    this.viewportObserver.dispose();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.ui.mute.removeEventListener('click', this.onMute);
    this.ui['reset-progress'].removeEventListener('click', this.onReset);
    this.element.querySelector('#show-tutorial').removeEventListener('click', this.onShowTutorial);
    if (this.onDebugPointer) this.ui.debug.removeEventListener('pointerdown', this.onDebugPointer);
    if (this.onDebugClick) this.ui['debug-controls'].removeEventListener('click', this.onDebugClick);
    if (this.onDebugChange) this.ui['debug-controls'].removeEventListener('change', this.onDebugChange);
    this.progressPanel.dispose();
    this.evidenceViewer.dispose();
    this.sessionEvidence.dispose(); this.evidenceStore.dispose();
    this.settingsController.dispose();
    this.skinShop.dispose();
    this.progressionDebug?.dispose();
    this.cosmetics.dispose();
    this.skinVisual.dispose();
    this.skinFactory.dispose();
    this.save.dispose();
    this.input.dispose();
    this.sound.dispose();
    this.particles.dispose();
    this.debugGeometry?.dispose();
    this.viewportGuide?.remove();
    this.clearMilestoneDecoration();
    for (const view of this.platformViews.values()) disposePlatform(view);
    if (this.routeView) { this.routeView.geometry.dispose(); this.routeView.material.dispose(); }
    this.column.geometry.dispose(); this.column.material.dispose();
    for (const mesh of [this.energyRing, this.shadow]) { mesh.geometry.dispose(); mesh.material.dispose(); }
    this.trail[0].geometry.dispose();
    for (const dot of this.trail) dot.material.dispose();
    disposeBritishMilestoneTextures();
    this.renderer.dispose();
  }
}
