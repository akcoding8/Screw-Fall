import { formatLevel } from './ProgressModel.js';

/** Keep the full integer visible even at the narrowest supported phone width. */
export function levelLabel(number) {
  const text = formatLevel(number);
  const fontSize = text.length > 18 ? 16 : text.length > 14 ? 19 : text.length > 10 ? 23 : text.length > 7 ? 27 : 31;
  return { text, fontSize };
}
