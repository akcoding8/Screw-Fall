import { normalizePoints, saturatingAdd, MAX_POINTS } from './ScoreFormatter.js';
import { sanitizeSave } from './SaveManager.js';

export function basePointsForLevel(level) {
  if (level?.kind === 'flow' || level?.isFlow === true) return 1;
  const rating = typeof level?.difficultyRating === 'number' && Number.isFinite(level.difficultyRating)
    ? Math.round(level.difficultyRating) : 2;
  return Math.max(2, Math.min(10, rating));
}

/** Scores only authoritative events; never reads a rendered position or skin. */
export class ScoringManager {
  constructor({ save, onEvent = () => {}, onWarning = message => console.warn(message) }) {
    this.save = save;
    this.onEvent = onEvent;
    this.onWarning = onWarning;
    this.sessionData = null;
    this.eligible = true;
    this.ineligibleReason = '';
    this.platforms = new Map();
    this.scored = new Set();
    this.invalidated = new Set();
    this.saturationWarned = false;
    this.warnSaturation = message => {
      if (!this.saturationWarned) { this.saturationWarned = true; this.onWarning(message); }
    };
    this.resetFromSave();
  }

  get data() { return this.sessionData ?? this.save.data; }
  get dropMultiplier() { return Math.max(1, this.dropStreak); }
  get recordRun() { return this.data.currentRunIsRecord; }
  get savePending() { return this.eligible && this.save.pending; }

  resetFromSave() {
    this.sessionData = null;
    this.eligible = true;
    this.ineligibleReason = '';
    this.basePoints = 2;
    this.dropStreak = 0;
    this.lastAward = 0;
    this.lastDeathScore = 0;
    this.lastDeathWasRecord = false;
    this.state = 'HOLDING';
    this.deathHandled = false;
    this.platforms.clear();
    this.scored.clear();
    this.invalidated.clear();
  }

  beginAttempt(level, state = 'HOLDING') {
    this.levelNumber = level?.levelNumber;
    this.basePoints = basePointsForLevel(level);
    this.state = state;
    this.dropStreak = 0;
    this.lastAward = 0;
    this.deathHandled = false;
    this.platforms.clear();
    this.scored.clear();
    this.invalidated.clear();
    for (const platform of level?.platforms ?? []) {
      if (!platform.finish && platform.active !== false) this.platforms.set(platform.id, platform);
    }
  }

  updateProgression(partial, { immediate = false } = {}) {
    if (this.sessionData) {
      this.sessionData = sanitizeSave({ ...this.sessionData, ...partial });
    } else if (immediate) this.save.save(partial);
    else this.save.updateDeferred(partial);
    return this.data;
  }

  resetDrop() { this.dropStreak = 0; }
  flush() { if (this.eligible) this.save.flush(); }

  handleEvent(event) {
    if (!event || typeof event !== 'object') return null;
    switch (event.type) {
      case 'stateChanged':
        this.state = event.state;
        if (['HOLDING', 'TRANSITIONING'].includes(event.state)) this.resetDrop();
        return null;
      case 'platformPassed': return this.awardPass(event);
      case 'platformSmashed':
        this.invalidated.add(event.platform?.id);
        this.resetDrop();
        this.flush();
        return null;
      case 'platformLanded':
      case 'gameLevelCompleted':
        this.resetDrop();
        this.flush();
        return null;
      case 'playerDied': return this.endRun();
      case 'retry':
      case 'manualReset':
        this.resetDrop();
        this.flush();
        return null;
      default: return null;
    }
  }

  awardPass(event) {
    const platform = event.platform;
    // Simulation deactivates a legitimately passed platform before emitting.
    // Identity + independent scored/smashed sets protect scoring without using
    // that visual/collision lifetime flag as a false rejection criterion.
    if (this.state !== 'ACTIVE' || !platform || platform.finish
      || this.platforms.get(platform.id) !== platform
      || this.scored.has(platform.id) || this.invalidated.has(platform.id)
      || (event.levelNumber !== undefined && event.levelNumber !== this.levelNumber)) return null;
    this.scored.add(platform.id);
    this.dropStreak = saturatingAdd(this.dropStreak, 1, this.warnSaturation);
    const awardedPoints = this.dropStreak > Math.floor(MAX_POINTS / this.basePoints)
      ? (this.warnSaturation('Point award reached Number.MAX_SAFE_INTEGER; the award is safely saturated.'), MAX_POINTS)
      : this.basePoints * this.dropStreak;
    const data = this.data;
    const currentNoDeathScore = saturatingAdd(data.currentNoDeathScore, awardedPoints, this.warnSaturation);
    const exceedsBest = currentNoDeathScore > data.bestNoDeathScore;
    const newBest = exceedsBest && !data.currentRunIsRecord;
    this.lastAward = awardedPoints;
    this.updateProgression({
      pointsBalance: saturatingAdd(data.pointsBalance, awardedPoints, this.warnSaturation),
      lifetimePoints: saturatingAdd(data.lifetimePoints, awardedPoints, this.warnSaturation),
      currentNoDeathScore,
      bestNoDeathScore: Math.max(data.bestNoDeathScore, currentNoDeathScore),
      currentRunIsRecord: data.currentRunIsRecord || exceedsBest,
    });
    const result = { type: 'pointsAwarded', awardedPoints, dropStreak: this.dropStreak,
      newBest, platformId: platform.id, eligible: this.eligible };
    this.onEvent(result);
    return result;
  }

  endRun() {
    if (this.deathHandled) return null;
    this.deathHandled = true;
    this.lastDeathScore = this.data.currentNoDeathScore;
    this.lastDeathWasRecord = this.recordRun;
    this.resetDrop();
    this.updateProgression({ currentNoDeathScore: 0, currentRunIsRecord: false,
      bestNoDeathScore: Math.max(this.data.bestNoDeathScore, this.lastDeathScore) }, { immediate: true });
    const result = { type: 'runEnded', finalScore: this.lastDeathScore,
      newBest: this.lastDeathWasRecord, eligible: this.eligible };
    this.onEvent(result);
    return result;
  }

  markIneligible(reason = 'Debug manipulation') {
    if (!this.eligible) return false;
    // Keep legitimately earned points, then fork. Debug deaths and purchases
    // must never reset/deduct from the normal no-death run or points balance.
    this.save.flush();
    this.sessionData = sanitizeSave(this.save.data);
    this.eligible = false;
    this.ineligibleReason = String(reason);
    this.resetDrop();
    return true;
  }

  grantTemporaryPoints(amount) {
    this.markIneligible('Temporary test points');
    const added = normalizePoints(amount);
    this.updateProgression({ pointsBalance: saturatingAdd(this.data.pointsBalance, added, this.warnSaturation) });
    return this.data.pointsBalance;
  }

  resetTemporaryScores() {
    this.markIneligible('Temporary score reset');
    this.updateProgression({ pointsBalance: 0, lifetimePoints: 0, currentNoDeathScore: 0,
      bestNoDeathScore: 0, currentRunIsRecord: false });
    this.resetDrop();
    this.lastAward = 0;
    this.lastDeathScore = 0;
    this.lastDeathWasRecord = false;
  }
}
