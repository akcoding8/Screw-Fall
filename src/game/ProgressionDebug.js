import * as THREE from 'three';
import { SKIN_CATALOG, PREMIUM_SKINS, PREMIUM_UNLOCK_POINTS, SKIN_COLLIDER_RADIUS, SKIN_VISUAL_ENVELOPE, getSkinDefinition } from './SkinCatalog.js';
import { CONFIG } from './config.js';
import { normalizeAngle, TAU } from './math.js';
import { getBritishPalette } from './BritishMilestoneTheme.js';
import { BRITISH_MILESTONE_KIND } from './BritishMilestone.js';
import { updatePlatformView } from './Platform.js';
import { PAINT_LIMITS } from './PaintMarkPool.js';

/** Session-only inspection; every modifying control first isolates the save. */
export class ProgressionDebug {
  constructor(game) {
    this.game = game;
    this.effectIndex = 0;
    this.events = [];
    const select = game.element.querySelector('#debug-skin');
    for (const skin of SKIN_CATALOG) {
      const option = select.ownerDocument.createElement('option'); option.value = skin.id; option.textContent = skin.name; select.append(option);
    }
    select.value = game.skins.selectedSkinId;
    this.select = select;
    this.guide = new THREE.Group();
    for (const [radius, color] of [[SKIN_COLLIDER_RADIUS, '#36e6ca'], [SKIN_VISUAL_ENVELOPE, '#fbb6cf']]) {
      this.guide.add(new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 10),
        new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: .6, depthTest: false })));
    }
    this.guide.visible = false; game.scene.add(this.guide);
  }
  handle(action, button) {
    const game = this.game;
    switch (action) {
      case 'import-start':
        game.scoring.markIneligible('Simulated starting-level import');
        // Reset this starting record atomically in the fork. Passing through
        // Level 1 first could invalidate an otherwise valid negative history.
        this.lastProgressResult = game.progress.confirmStartingLevel({ startingLevel: 1757, source: 'Debug simulation' },
          { temporaryOverwrite: true });
        if (this.lastProgressResult.ok) game.applyImportedProgress();
        break;
      case 'import-adjust':
        game.scoring.markIneligible('Simulated imported adjustment');
        this.lastProgressResult = game.progress.addAdjustment({ amount: 32, reason: 'elsewhere', source: 'Debug simulation' });
        if (this.lastProgressResult.ok) game.applyImportedProgress();
        break;
      case 'milestone-100': game.loadDebugLevel(100); break;
      case 'milestone-200': game.loadDebugLevel(200); break;
      case 'british-palette': {
        game.scoring.markIneligible('British palette preview');
        if (game.simulation.level.kind !== BRITISH_MILESTONE_KIND) game.loadDebugLevel(100);
        const family = game.simulation.level.palette.family === 'vivid' ? 'soft' : 'vivid';
        game.applyPalette(getBritishPalette(game.simulation.levelNumber, family));
        button?.setAttribute('aria-pressed', String(family === 'vivid'));
        break;
      }
      case 'paint-edge': this.previewPaint(false); break;
      case 'paint-smash': this.previewPaint(true); break;
      case 'test-points': game.scoring.grantTemporaryPoints(20000); break;
      case 'premium-points': game.scoring.grantTemporaryPoints(1000000); break;
      case 'premium-milestone':
        game.scoring.markIneligible('Temporary Premium milestone');
        game.scoring.updateProgression({ lifetimePoints: Math.max(game.scoring.data.lifetimePoints, PREMIUM_UNLOCK_POINTS) });
        break;
      case 'reset-scores': game.scoring.resetTemporaryScores(); break;
      case 'unlock-skins': game.skins.unlockAllTemporary(); break;
      case 'effect-profile': {
        game.scoring.markIneligible('Effect profile preview');
        this.effectIndex = (this.effectIndex + 1) % SKIN_CATALOG.length;
        game.cosmetics.setSkin(SKIN_CATALOG[this.effectIndex], game.simulation.level.palette);
        break;
      }
      case 'skin-envelope': this.guide.visible = !this.guide.visible; button.setAttribute('aria-pressed', String(this.guide.visible)); break;
      case 'paint-attachment':
        this.paintGuides = !this.paintGuides; game.cosmetics.setAttachmentDebug(this.paintGuides);
        button.setAttribute('aria-pressed', String(this.paintGuides)); break;
      default: return false;
    }
    game.scoreHUD.refresh(); game.ui['debug-info'].textContent = game.debugText();
    return true;
  }
  preview(id) {
    this.game.skins.unlockAllTemporary(); this.game.skins.equip(id);
    this.game.scoreHUD.refresh();
  }
  /** Developer-only contact setup; smash goes through the real simulation event. */
  previewPaint(smash) {
    const game = this.game;
    game.scoring.markIneligible(smash ? 'Forced paint smash' : 'Forced paint edge impact');
    game.loadDebugLevel(game.simulation.levelNumber);
    if (!getSkinDefinition(game.skins.selectedSkinId).effects.paint) {
      game.skins.unlockAllTemporary();
      game.skins.equip('duo-splash');
    }
    const sim = game.simulation;
    const platform = sim.platforms.find(item => !item.finish && !item.motion && !item.walls?.length
      && item.segments.some(segment => segment.kind === 'safe'));
    const segment = platform?.segments.find(item => item.kind === 'safe');
    const view = platform && game.platformViews.get(platform.id);
    if (!segment || !view) return false;
    const span = Math.abs(segment.end - segment.start) >= TAU - 1e-8 ? TAU : normalizeAngle(segment.end - segment.start);
    const angle = normalizeAngle(segment.start + (smash ? span / 2 : Math.min(.008, span / 4)));
    sim.rotation = normalizeAngle(angle - CONFIG.world.ballWorldAngle + (platform.baseRotation || 0));
    game.tower.rotation.y = sim.rotation;
    updatePlatformView(view, platform);
    game.tower.updateMatrixWorld(true);
    if (smash) {
      sim.ball.y = sim.ball.previousY = platform.y + CONFIG.physics.ballRadius + .015;
      sim.ball.bouncePlaneY = platform.y;
      sim.ball.velocity = -3;
      sim.rotate(.00001);
      sim.setPassCount(CONFIG.smash.threshold);
      sim.smashReady = true;
      sim.step(CONFIG.physics.fixedStep);
      this.lastPaintPreview = `Actual smash contact · platform ${platform.id} · ${platform.active ? 'not contacted' : 'destroyed'}`;
    } else {
      const contact = view.localToWorld(new THREE.Vector3(Math.cos(angle) * CONFIG.world.ballOrbitRadius, 0,
        Math.sin(angle) * CONFIG.world.ballOrbitRadius));
      game.cosmetics.onLanding(platform, view, angle, contact);
      game.cosmetics.paint.update();
      this.lastPaintPreview = `Edge contact · platform ${platform.id} · ${(angle * 180 / Math.PI).toFixed(2)}°`;
    }
    game.resetMotionHistory();
    return true;
  }
  record(event) {
    this.events.push(event.type === 'pointsAwarded' ? `pass ${event.platformId}: +${event.awardedPoints} ×${event.dropStreak}` : `death: ${event.finalScore}`);
    if (this.events.length > 4) this.events.shift();
  }
  update(position) { if (this.guide.visible) this.guide.position.copy(position); }
  text() {
    const { scoring: score, skins, cosmetics } = this.game, data = score.data;
    const progress = this.game.progress, level = this.game.simulation?.level;
    const paint = cosmetics.paint?.records?.find(record => record.active);
    const ownedPremium = PREMIUM_SKINS.filter(skin => skins.isOwned(skin.id)).map(skin => skin.name);
    return [
      `Scoring ${score.eligible ? 'ELIGIBLE' : `SESSION ONLY · ${score.ineligibleReason}`}`,
      `Save schema ${CONFIG.save.version} · starting ${data.startingLevel ?? 1} · completed here ${data.levelsCompletedHere ?? 0}`,
      `Imported adjustments ${progress?.adjustmentTotal ?? 0} · derived level ${progress?.currentLevel ?? data.levelNumber}`,
      `Evidence metadata: stored ${this.game.evidenceStore?.metadataCount ?? 0} · session ${this.game.sessionEvidence?.metadataCount ?? 0}`,
      `Tutorial ${data.hintSeen ? 'learned' : 'new player'}`,
      `Base ${score.basePoints} · drop ${score.dropStreak} · ×${score.dropMultiplier} · last +${score.lastAward}`,
      `Score ${data.currentNoDeathScore} · best ${data.bestNoDeathScore}`,
      `Points ${data.pointsBalance} · lifetime ${data.lifetimePoints} · save ${score.savePending ? 'pending' : 'settled'}`,
      `Premium ${skins.premiumUnlocked ? 'unlocked' : 'locked'} · milestone ${PREMIUM_UNLOCK_POINTS}`,
      `Owned Premium ${ownedPremium.length}/${PREMIUM_SKINS.length}: ${ownedPremium.join(', ') || 'none'}`,
      `Skin ${skins.selectedSkinId} · effects ${cosmetics.profileName}`,
      `Paint ${cosmetics.paintCount ?? 0}/64 · trail ${cosmetics.trailCount ?? 0}/36`,
      `Splash authored radius ${cosmetics.profile?.paint ? cosmetics.profile.paintSize.toFixed(2) : 'none'} · clipped to safe surface`,
      ...(paint ? [`Paint mask: radius ${paint.size.toFixed(3)} · safe arc ${paint.segmentStart.toFixed(3)} + ${paint.segmentSpan.toFixed(3)} rad · ${paint.wallCount} walls`,
        `Paint annulus ${(CONFIG.world.innerRadius + PAINT_LIMITS.edgeClearance).toFixed(3)}–${(CONFIG.world.outerRadius - PAINT_LIMITS.edgeClearance).toFixed(3)} · full-size pixel discard`] : []),
      ...(level?.milestone ? [`British #${level.milestone.index} · generator ${level.milestone.generatorVersion} · theme ${level.milestone.themeVersion}`,
        `Milestone ${level.platformCount} platforms · ${level.palette.family} · theme seed ${level.milestone.themeSeed}`] : []),
      ...(this.lastPaintPreview ? [this.lastPaintPreview] : []),
      ...(this.lastProgressResult && !this.lastProgressResult.ok ? [this.lastProgressResult.error] : []),
      `Collider ${SKIN_COLLIDER_RADIUS} · visual envelope ${SKIN_VISUAL_ENVELOPE.toFixed(3)}`,
      ...this.events,
    ].join('\n');
  }
  dispose() { for (const mesh of this.guide.children) { mesh.geometry.dispose(); mesh.material.dispose(); } this.guide.removeFromParent(); }
}
