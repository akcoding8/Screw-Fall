import { CONFIG } from './config.js';
import { TAU } from './math.js';

const radians = (degrees) => (degrees * Math.PI) / 180;

// Each row is [gap centre in degrees, gap width, hazard width, hazard centre?].
// Hazard centre is relative to the gap and defaults to the opposite side, 180°.
// Two-gap chutes end on safe arrival platforms: a smaller hazard at 100° leaves
// the whole shared opening clear for landing. Three-gap chutes end on solid
// contact for a guaranteed smash opportunity. Named sections alternate these
// drops with generous individual turns, keeping the longer towers friendly.
// These are finite authored rows, not a procedural generator or difficulty curve.
const LAYOUTS = [
  {
    name: 'Soft Current',
    palette: {
      background: '#f1eee5', safe: '#43b4a5', hazard: '#e76a4c',
      column: '#d1dbd3', ball: '#fff3bc', finish: '#d5b75e', accent: '#234f4d',
    },
    sections: [
      { name: 'Familiar opening', rows: [
        [0, 96, 38], [8, 96, 42], [-8, 92, 46], [180, 88, 46],
        [82, 98, 40], [96, 94, 46], [230, 92, 24, 100], [218, 98, 42],
        [232, 94, 46], [50, 98, 44], [320, 96, 46], [308, 94, 44],
        [154, 96, 24, 100], [166, 92, 42], [150, 96, 46], [332, 106, 40],
      ] },
      { name: 'Broad turns', rows: [
        [92, 108, 28], [212, 108, 28],
        [336, 104, 32], [348, 100, 34], [166, 104, 22, 100], // Pair, safe catch.
        [58, 108, 28],
      ] },
      { name: 'Middle chute', rows: [
        [274, 100, 34], [286, 96, 36], [264, 98, 38], [94, 104, 30], // Triple, smash.
        [214, 108, 28], [332, 104, 32],
      ] },
      { name: 'Long bend', rows: [
        [110, 108, 28],
        [230, 104, 32], [244, 98, 34], [64, 106, 22, 100], // Pair, safe catch.
        [178, 108, 28],
        [294, 104, 32], [306, 100, 34], [124, 106, 22, 100], // Pair, safe catch.
      ] },
      { name: 'Last light', rows: [
        [8, 108, 28],
        [224, 102, 34], [236, 96, 36], [214, 98, 38], [44, 108, 30], // Triple, smash.
        [166, 110, 26], [286, 108, 28], [52, 112, 24],
      ] },
    ],
  },
  {
    name: 'Apricot Orbit',
    palette: {
      background: '#f5ebe3', safe: '#e5a17d', hazard: '#74517d',
      column: '#dccbbd', ball: '#fff5c6', finish: '#b1bb72', accent: '#65463d',
    },
    sections: [
      { name: 'Familiar opening', rows: [
        [-18, 100, 40], [-6, 96, 42], [-24, 94, 44], [162, 92, 48],
        [252, 98, 44], [266, 96, 42], [102, 98, 24, 100], [88, 96, 44],
        [108, 96, 42], [286, 94, 48], [32, 100, 40], [20, 98, 44],
        [198, 96, 24, 100], [212, 94, 46], [202, 96, 44], [20, 106, 40],
      ] },
      { name: 'Orchard turns', rows: [
        [138, 108, 28], [258, 106, 30],
        [24, 102, 34], [36, 98, 36], [214, 104, 22, 100], // Pair, safe catch.
        [104, 108, 28], [342, 106, 30], [224, 108, 28],
      ] },
      { name: 'Open orbit', rows: [
        [86, 100, 34], [98, 98, 36], [76, 96, 38], [256, 106, 30], // Triple, smash.
        [16, 110, 26],
        [136, 104, 32], [150, 100, 34], [330, 106, 22, 100], // Pair, safe catch.
      ] },
      { name: 'Gentle switchbacks', rows: [
        [212, 108, 28], [92, 106, 30],
        [326, 102, 34], [338, 98, 36], [156, 106, 22, 100], // Pair, safe catch.
        [36, 108, 28], [272, 106, 30], [152, 108, 28],
      ] },
      { name: 'Sunset run', rows: [
        [18, 100, 34], [30, 96, 36], [8, 98, 38], [190, 108, 30], // Triple, smash.
        [310, 110, 26], [74, 112, 24],
      ] },
    ],
  },
  {
    name: 'Blue Hour',
    palette: {
      background: '#e7edf2', safe: '#6d98b8', hazard: '#d97190',
      column: '#c6d2dc', ball: '#ffefd0', finish: '#bda875', accent: '#3b5871',
    },
    sections: [
      { name: 'Familiar opening', rows: [
        [18, 96, 42], [6, 98, 44], [24, 94, 46], [198, 94, 44],
        [120, 96, 42], [132, 98, 46], [300, 96, 24, 100], [312, 94, 48],
        [294, 96, 42], [114, 98, 44], [218, 96, 48], [204, 100, 40],
        [38, 98, 24, 100], [50, 96, 44], [32, 94, 46], [212, 106, 40],
      ] },
      { name: 'Wide horizon', rows: [
        [90, 108, 28], [326, 106, 30],
        [208, 102, 34], [220, 98, 36], [40, 106, 22, 100], // Pair, safe catch.
        [158, 108, 28], [280, 106, 30], [42, 108, 28],
      ] },
      { name: 'Blue descent', rows: [
        [178, 100, 34], [190, 96, 36], [168, 98, 38], [352, 106, 30], // Triple, smash.
        [116, 110, 26],
        [234, 104, 32], [246, 100, 34], [66, 106, 22, 100], // Pair, safe catch.
      ] },
      { name: 'Quiet bends', rows: [
        [304, 108, 28], [182, 108, 28],
        [60, 102, 34], [72, 98, 36], [252, 106, 22, 100], // Pair, safe catch.
        [12, 108, 28], [132, 106, 30], [14, 108, 28],
      ] },
      { name: 'Homeward drop', rows: [
        [234, 100, 34], [246, 96, 36], [224, 98, 38], [44, 106, 30], // Triple, smash.
        [166, 110, 26],
        [284, 106, 28], [296, 100, 30], [116, 112, 22, 100], // Pair, safe catch.
      ] },
    ],
  },
];

/** Every call owns fresh gameplay data; retry never mutates a source layout. */
export function createPrototypeLevel(levelNumber = 1) {
  const number = Number.isSafeInteger(levelNumber) && levelNumber > 0 ? levelNumber : 1;
  const layoutIndex = (number - 1) % LAYOUTS.length;
  const source = LAYOUTS[layoutIndex];
  const rows = source.sections.flatMap((section) => section.rows);
  const platforms = rows.map(([gapCenter, gapWidth, hazardWidth, hazardCenter = 180], index) => {
    const gapHalf = radians(gapWidth / 2);
    const hazardStart = radians(hazardCenter - hazardWidth / 2);
    const hazardEnd = radians(hazardCenter + hazardWidth / 2);
    return {
      id: `platform-${index}`,
      y: index === 0 ? 0 : -index * CONFIG.world.platformSpacing,
      baseRotation: radians(gapCenter),
      active: true,
      finish: false,
      segments: [
        { kind: 'safe', start: gapHalf, end: hazardStart },
        { kind: 'hazard', start: hazardStart, end: hazardEnd },
        { kind: 'safe', start: hazardEnd, end: TAU - gapHalf },
      ],
    };
  });
  platforms.push({
    id: 'finish', y: -platforms.length * CONFIG.world.platformSpacing,
    baseRotation: 0, active: true, finish: true,
    segments: [{ kind: 'safe', start: 0, end: TAU }],
  });
  return { name: source.name, layoutIndex, palette: { ...source.palette }, platforms };
}

