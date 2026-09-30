/** All candidates refer to the approved Phase 2 cap, never to a previous selection. */
export const PHASE2_TERMINAL_SPEED = 23;
export const PRODUCTION_TERMINAL_PERCENT = 80;
export const TERMINAL_SPEED_OPTIONS = Object.freeze([100, 90, 80, 75]);

export function terminalSpeedForPercent(percent) {
  if (!TERMINAL_SPEED_OPTIONS.includes(percent)) return null;
  return PHASE2_TERMINAL_SPEED * percent / 100;
}

export const PRODUCTION_TERMINAL_SPEED = terminalSpeedForPercent(PRODUCTION_TERMINAL_PERCENT);
