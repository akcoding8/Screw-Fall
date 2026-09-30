import { CONFIG } from './config.js';
import { createLevel } from './LevelManager.js';
import { clamp, normalizeAngle } from './math.js';
import { classifyPlatformAtTime, evaluatePlatformMotion } from './PlatformMotion.js';
import { resolveWallRotation, resolveWallSweep } from './WallCollisionResolver.js';
import { PRODUCTION_TERMINAL_PERCENT, terminalSpeedForPercent } from './TerminalSpeed.js';

export const STATES = Object.freeze({
  HOLDING: 'HOLDING', ACTIVE: 'ACTIVE', DEAD_ANIMATION: 'DEAD_ANIMATION',
  DEAD_WAITING: 'DEAD_WAITING', COMPLETING: 'COMPLETING', TRANSITIONING: 'TRANSITIONING',
});

/** Pure gameplay state. DOM, Three.js, audio, and elapsed-frame accumulation live in adapters. */
export class Simulation {
  constructor({ levelNumber = 1, onEvent = () => {}, levelFactory = createLevel, paletteStyle = 'soft', debugEnabled = false,
    resolveNextLevel = number => Math.min(Number.MAX_SAFE_INTEGER, number + 1) } = {}) {
    this.onEvent = onEvent;
    this.levelFactory = levelFactory;
    this.resolveNextLevel = resolveNextLevel;
    this.paletteStyle = paletteStyle;
    this.debugEnabled = debugEnabled;
    this.terminalSpeedPercent = PRODUCTION_TERMINAL_PERCENT;
    this.debugTerminalSpeed = null;
    this.wallResult = {};
    this.state = STATES.TRANSITIONING;
    this.loadLevel(levelNumber);
  }

  emit(type, detail = {}) {
    this.onEvent({
      type, levelNumber: this.levelNumber,
      difficultyRating: this.level?.difficultyRating,
      isFlow: this.level?.kind === 'flow',
      passCount: this.passCount,
      platformIndex: detail.platform?.index,
      platformType: detail.platform?.type ?? (detail.platform?.finish ? 'finish' : 'static'),
      ...detail,
    });
  }

  setState(state) {
    if (state === this.state) return;
    const previousState = this.state;
    this.state = state;
    this.stateElapsed = 0;
    this.emit('stateChanged', { state, previousState });
  }

  setPassCount(count) {
    if (count === this.passCount) return;
    this.passCount = count;
    this.emit('dropStreakChanged');
  }

  get maxDownwardSpeed() {
    return this.debugEnabled && this.debugTerminalSpeed !== null
      ? this.debugTerminalSpeed : CONFIG.physics.maxDownwardSpeed;
  }

  /** In-memory comparison only. A fresh non-debug game always uses production. */
  setDebugTerminalSpeed(percent) {
    const cap = terminalSpeedForPercent(percent);
    if (!this.debugEnabled || cap === null) return false;
    this.terminalSpeedPercent = percent;
    this.debugTerminalSpeed = cap;
    // Lowering the cap mid-fall does not move the ball or alter an upward bounce.
    this.ball.velocity = Math.max(-cap, this.ball.velocity);
    return true;
  }

  loadLevel(levelNumber) {
    this.levelNumber = Number.isSafeInteger(levelNumber) && levelNumber > 0 ? levelNumber : 1;
    this.level = this.levelFactory(this.levelNumber, { paletteStyle: this.paletteStyle });
    // The collision list stays in descending height order, independent of drawing order.
    this.platforms = this.level.platforms;
    this.motionPlatforms = this.platforms.filter(platform => platform.motion);
    this.wallPlatforms = this.platforms.filter(platform => platform.walls?.length);
    this.animationTime = 0;
    this.animationPaused = false;
    this.updateMotion();
    this.rotation = 0;
    this.passCount = 0;
    this.smashReady = false;
    this.progress = 0;
    this.anchorY = this.platforms[0].y;
    const y = this.anchorY + CONFIG.physics.ballRadius;
    this.ball = { y, previousY: y, velocity: CONFIG.physics.bounceVelocity, bouncePlaneY: this.anchorY };
    this.stateElapsed = 0;
    this.setState(STATES.HOLDING);
    this.emit('levelLoaded');
    if (this.level.kind === 'flow') this.emit('flowLevelStarted');
  }

  updateMotion() {
    for (const platform of this.motionPlatforms) {
      if (platform.active) evaluatePlatformMotion(platform, this.animationTime);
    }
  }

  /** Pointer movement stays immediate; a lethal sweep consumes its remainder. */
  rotate(deltaRadians) {
    if (this.state !== STATES.HOLDING && this.state !== STATES.ACTIVE) return false;
    if (!Number.isFinite(deltaRadians) || deltaRadians === 0) return false;
    const result = resolveWallRotation(this.wallPlatforms, this.rotation, deltaRadians, this.ball.y, this.wallResult);
    this.rotation = normalizeAngle(this.rotation + result.delta);
    if (result.wall) {
      this.dieOnWall(result, this.animationTime, deltaRadians);
      return true;
    }
    if (this.state === STATES.HOLDING) this.setState(STATES.ACTIVE);
    return true;
  }

  /** One contact boundary for top, side and underside walls, including smash. */
  dieOnWall(result, impactTime, requestedDelta = 0) {
    if (this.state !== STATES.HOLDING && this.state !== STATES.ACTIVE) return false;
    this.ball.y = result.y;
    this.ball.previousY = result.y;
    this.ball.velocity = 0;
    this.setPassCount(0);
    this.smashReady = false;
    this.setState(STATES.DEAD_ANIMATION);
    this.emit('playerDied', {
      platform: result.platform, wall: result.wall, wallContact: true,
      impactTime, contactFraction: result.fraction, requestedDelta, appliedDelta: result.delta,
    });
    return true;
  }

  retry() {
    if (this.state !== STATES.DEAD_WAITING) return false;
    this.loadLevel(this.levelNumber);
    return true;
  }

  /** Both solid landing types use exactly the same contact plane and rebound. */
  rebound(platform, contactY = platform.y + CONFIG.physics.ballRadius) {
    this.ball.y = contactY;
    this.ball.velocity = CONFIG.physics.bounceVelocity;
    this.ball.bouncePlaneY = contactY - CONFIG.physics.ballRadius;
    this.setPassCount(0);
  }

  step(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (this.state === STATES.DEAD_ANIMATION || this.state === STATES.COMPLETING) {
      this.stateElapsed += dt;
      if (this.state === STATES.DEAD_ANIMATION && this.stateElapsed + 1e-9 >= CONFIG.timing.deathDuration) {
        this.setState(STATES.DEAD_WAITING);
      } else if (this.state === STATES.COMPLETING && this.stateElapsed + 1e-9 >= CONFIG.timing.completionHold) {
        this.setState(STATES.TRANSITIONING);
        // JavaScript cannot represent the next integer beyond this boundary.
        // Replay the final representable tower instead of resetting progress.
        this.loadLevel(this.resolveNextLevel(this.levelNumber));
      }
      return;
    }
    if (this.state !== STATES.HOLDING && this.state !== STATES.ACTIVE) return;

    const startTime = this.animationTime;
    const timeDelta = this.animationPaused ? 0 : dt;
    this.animationTime += timeDelta;
    const ball = this.ball;
    ball.previousY = ball.y;
    // The bounce arc retains its approved gravity until the last contact plane.
    const gravity = ball.y - CONFIG.physics.ballRadius >= ball.bouncePlaneY - 1e-9
      ? CONFIG.physics.bounceGravity : CONFIG.physics.freeFallGravity;
    ball.velocity = Math.max(-this.maxDownwardSpeed, ball.velocity - gravity * dt);
    const nextY = ball.y + ball.velocity * dt;
    ball.y = nextY;
    const wallHit = resolveWallSweep(this.wallPlatforms, this.rotation, 0, ball.previousY, nextY, this.wallResult);
    let resolvedPlane = false;

    if (ball.velocity > 0) {
      // Preserve the existing live-ceiling safeguard for an elevated/debug
      // rebound, without changing launch impulse, gravity or platform spacing.
      // Flat platform hazards still kill on top only; vertical fins are lethal.
      const previousTop = ball.previousY + CONFIG.physics.ballRadius;
      const nextTop = nextY + CONFIG.physics.ballRadius;
      for (let index = this.platforms.length - 1; index >= 0; index--) {
        const platform = this.platforms[index];
        const underside = platform.y - CONFIG.world.platformThickness;
        if (!platform.active || underside < previousTop - 1e-9 || underside > nextTop + 1e-9) continue;
        const fraction = clamp((underside - previousTop) / (nextTop - previousTop), 0, 1);
        if (wallHit.wall && wallHit.fraction <= fraction) break;
        if (classifyPlatformAtTime(platform, this.rotation, startTime + timeDelta * fraction) !== 'gap') {
          ball.y = underside - CONFIG.physics.ballRadius;
          ball.velocity = 0;
          this.emit('ceilingContact', { platform });
          resolvedPlane = true;
          break;
        }
      }
    } else if (ball.velocity < 0) {
      const previousBottom = ball.previousY - CONFIG.physics.ballRadius;
      const nextBottom = nextY - CONFIG.physics.ballRadius;
      // Every crossed plane samples motion at its own time of impact. Resolving
      // any solid contact invalidates the remainder of this old downward path.
      for (const platform of this.platforms) {
        if (!platform.active) continue;
        if (platform.y > previousBottom + 1e-9 || platform.y < nextBottom - 1e-9) continue;
        const fraction = clamp((previousBottom - platform.y) / (previousBottom - nextBottom), 0, 1);
        if (wallHit.wall && wallHit.fraction <= fraction) break;
        const impactTime = startTime + timeDelta * fraction;
        const kind = classifyPlatformAtTime(platform, this.rotation, impactTime);
        if (kind === 'gap') {
          platform.active = false;
          // Passing the parent destroys its fin immediately. Re-sweep only if
          // this invalidated the selected contact; later live walls still count.
          if (wallHit.platform === platform) {
            resolveWallSweep(this.wallPlatforms, this.rotation, 0, ball.previousY, nextY, wallHit);
          }
          this.setPassCount(this.passCount + 1);
          this.emit('platformPassed', { platform, impactTime });
          if (!this.smashReady && this.passCount >= CONFIG.smash.threshold) {
            this.smashReady = true;
            this.emit('smashActivated', { platform });
          }
          continue;
        }
        if (kind === 'finish') {
          resolvedPlane = true;
          ball.y = platform.y + CONFIG.physics.ballRadius;
          ball.velocity = 0;
          this.setPassCount(0);
          this.smashReady = false;
          this.setState(STATES.COMPLETING);
          this.emit('gameLevelCompleted', { platform, impactTime });
          if (this.level.kind === 'flow') this.emit('flowLevelCompleted', { platform, impactTime });
          break;
        }
        if (this.smashReady) {
          resolvedPlane = true;
          const impactVelocity = ball.velocity;
          platform.active = false;
          this.rebound(platform);
          this.smashReady = false;
          this.emit('platformSmashed', { platform, kind, impactTime, impactVelocity, bounceVelocity: ball.velocity, smashed: true });
          break;
        }
        ball.y = platform.y + CONFIG.physics.ballRadius;
        resolvedPlane = true;
        this.setPassCount(0);
        if (kind === 'hazard') {
          ball.velocity = 0;
          this.smashReady = false;
          this.setState(STATES.DEAD_ANIMATION);
          this.emit('playerDied', { platform, impactTime });
        } else {
          this.rebound(platform);
          this.emit('platformLanded', { platform, impactTime });
        }
        break;
      }
    }
    if (!resolvedPlane && wallHit.wall) this.dieOnWall(wallHit, startTime + timeDelta * wallHit.fraction);
    this.updateMotion();
    // Only downward progress moves the camera and progress bar.
    this.anchorY = Math.min(this.anchorY, ball.y - CONFIG.physics.ballRadius);
    const topY = this.platforms[0].y;
    const finishY = this.platforms[this.platforms.length - 1].y;
    this.progress = clamp((topY - this.anchorY) / (topY - finishY), 0, 1);
  }
}
