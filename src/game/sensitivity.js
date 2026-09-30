import { CONFIG } from './config.js';

/** Keep saved values and slider input on the same supported multiplier steps. */
export function normalizeSensitivity(value, config = CONFIG.input.multiplier) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return config.default;
  const clamped = Math.min(config.max, Math.max(config.min, value));
  const stepped = config.min + Math.round((clamped - config.min) / config.step) * config.step;
  return Number(Math.min(config.max, Math.max(config.min, stepped)).toFixed(1));
}

export function formatSensitivity(value) {
  return `${normalizeSensitivity(value).toFixed(1)}×`;
}
