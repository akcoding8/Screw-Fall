import { Vector3 } from 'three';
import { formatScore } from './ScoreFormatter.js';

export const SCORE_FEEDBACK_MERGE_SECONDS = .14;

/** A fixed set of DOM nodes. Fast passes merge visually, never arithmetically. */
export class ScoreHUD {
  constructor(element, scoring) {
    this.scoring = scoring;
    this.nodes = Object.fromEntries(['score-hud', 'score-current', 'score-best', 'score-points',
      'score-holding', 'score-record', 'score-feedback', 'score-award', 'score-multiplier',
      'death-score', 'death-score-value', 'death-best-value', 'death-record'].map(id => [id, element.querySelector(`#${id}`)]));
    this.projected = new Vector3();
    this.clock = 0;
    this.awardTime = -10;
    this.mergeStarted = -10;
    this.recordUntil = 0;
    this.mergedAward = 0;
    this.state = 'HOLDING';
  }

  text(id, value) { const node = this.nodes[id]; if (node.textContent !== value) node.textContent = value; }

  onEvent(event) {
    if (event?.type === 'pointsAwarded') {
      if (this.clock - this.mergeStarted <= SCORE_FEEDBACK_MERGE_SECONDS) {
        this.mergedAward = Math.min(Number.MAX_SAFE_INTEGER, this.mergedAward + event.awardedPoints);
      } else {
        this.mergedAward = event.awardedPoints; this.mergeStarted = this.clock;
      }
      this.awardTime = this.clock;
      this.text('score-award', `+${formatScore(this.mergedAward)}`);
      if (event.newBest) this.recordUntil = this.clock + 2.4;
    }
    this.refresh();
  }

  setState(state) {
    this.state = state;
    const dead = state === 'DEAD_ANIMATION' || state === 'DEAD_WAITING';
    this.nodes['score-holding'].hidden = state !== 'HOLDING';
    this.nodes['score-hud'].hidden = dead || state === 'HOLDING';
    this.nodes['death-score'].hidden = !dead;
    if (state !== 'ACTIVE') { this.awardTime = -10; this.mergeStarted = -10; this.recordUntil = 0; }
    this.refresh();
  }

  refresh() {
    const score = this.scoring, data = score.data;
    this.text('score-current', formatScore(data.currentNoDeathScore));
    this.text('score-best', formatScore(data.bestNoDeathScore));
    this.text('score-points', formatScore(data.pointsBalance));
    this.text('death-score-value', formatScore(score.lastDeathScore));
    this.text('death-best-value', formatScore(data.bestNoDeathScore));
    this.nodes['death-record'].hidden = !score.lastDeathWasRecord;
    this.text('score-multiplier', score.dropStreak > 1 ? `×${score.dropStreak}` : '');
  }

  update(dt, position, camera, width, height) {
    this.clock += dt;
    const visible = this.state === 'ACTIVE' && this.clock - this.awardTime < .68;
    const feedback = this.nodes['score-feedback'];
    const feedbackVisible = visible || (this.state === 'ACTIVE' && this.scoring.dropStreak > 1);
    if (feedback.hidden === feedbackVisible) feedback.hidden = !feedbackVisible;
    const recordHidden = this.state !== 'ACTIVE' || this.clock >= this.recordUntil;
    if (this.nodes['score-record'].hidden !== recordHidden) this.nodes['score-record'].hidden = recordHidden;
    // Keep the reusable multiplier visible through a long drop, even when the
    // last rolling award has faded. No layout reads occur in this path.
    if (this.nodes['score-award'].hidden === visible) this.nodes['score-award'].hidden = !visible;
    if (!feedback.hidden) {
      this.projected.copy(position).project(camera);
      const x = Math.min(width - 54, Math.max(54, (this.projected.x * .5 + .5) * width + 49));
      const y = Math.max(183, Math.min(height - 100, (-this.projected.y * .5 + .5) * height - 24));
      feedback.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`;
    }
  }
}
