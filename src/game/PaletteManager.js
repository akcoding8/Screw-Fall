/** Colour has its own version and seed; it never consumes geometry randomness. */
export const PALETTE_VERSION = 1;
export const PALETTE_STYLES = Object.freeze(['soft', 'vivid', 'mixed']);
export const PALETTE_LIMITS = Object.freeze({
  surfaceContrast: 1.5,
  surfaceHueSeparation: 55,
  ballContrast: 2,
  interfaceContrast: 4.5,
  backgroundContrast: 1.35,
});

export const PALETTE_COLOR_FIELDS = Object.freeze([
  'background', 'column', 'safe', 'safeSide', 'hazard', 'hazardSide',
  'hazardDetail', 'ball', 'ballShadow', 'particle', 'finish', 'accent', 'uiBackground',
]);

// Each family is curated in five colour groups: teal, clay, violet, ochre, blue.
// Each group has four distinct compositions. These are deliberate colour choices,
// including side colours and accents, rather than a saturation transformation.
const soft = [
  {
    id: 'soft-tidal-sage', name: 'Tidal Sage', family: 'soft',
    background: '#f1eee5', column: '#788f87', safe: '#398f81', safeSide: '#2c7168',
    hazard: '#9d4453', hazardSide: '#773444', hazardDetail: '#f4b8a2',
    ball: '#ffe3a3', ballShadow: '#24483f', particle: '#c0ba73', finish: '#a78b3d',
    accent: '#234f4d', uiBackground: '#f1eee5', confetti: ['#398f81', '#d9957f', '#c0ba73', '#ffe3a3'],
  },
  {
    id: 'soft-jade-linen', name: 'Jade Linen', family: 'soft',
    background: '#eeeedd', column: '#7c9487', safe: '#458d73', safeSide: '#376d5b',
    hazard: '#955166', hazardSide: '#733d50', hazardDetail: '#f1b6bf',
    ball: '#f9dca9', ballShadow: '#304a40', particle: '#c5a268', finish: '#9f8048',
    accent: '#344d40', uiBackground: '#eeeedd', confetti: ['#458d73', '#b47988', '#c5a268', '#f9dca9'],
  },
  {
    id: 'soft-sea-glass', name: 'Sea Glass', family: 'soft',
    background: '#e9f0e9', column: '#768f90', safe: '#338e8d', safeSide: '#286f72',
    hazard: '#a04d47', hazardSide: '#7a3b39', hazardDetail: '#efb394',
    ball: '#f4d6b2', ballShadow: '#28434a', particle: '#c7b878', finish: '#9b874a',
    accent: '#284c50', uiBackground: '#e9f0e9', confetti: ['#338e8d', '#ca9185', '#c7b878', '#f4d6b2'],
  },
  {
    id: 'soft-herb-garden', name: 'Herb Garden', family: 'soft',
    background: '#f0eee2', column: '#82917d', safe: '#57896a', safeSide: '#436b53',
    hazard: '#974d72', hazardSide: '#743d59', hazardDetail: '#eab5d0',
    ball: '#f6dba0', ballShadow: '#354b39', particle: '#bbb572', finish: '#928548',
    accent: '#3b4e36', uiBackground: '#f0eee2', confetti: ['#57896a', '#bd91a7', '#bbb572', '#f6dba0'],
  },
  {
    id: 'soft-apricot-orbit', name: 'Apricot Orbit', family: 'soft',
    background: '#f5ebe3', column: '#988273', safe: '#b67855', safeSide: '#8e5c42',
    hazard: '#674e87', hazardSide: '#4d3a69', hazardDetail: '#ceb5e8',
    ball: '#d8ecc0', ballShadow: '#573d34', particle: '#a5b572', finish: '#8a9551',
    accent: '#65463d', uiBackground: '#f5ebe3', confetti: ['#b67855', '#a98fbd', '#a5b572', '#d8ecc0'],
  },
  {
    id: 'soft-clay-meadow', name: 'Clay Meadow', family: 'soft',
    background: '#f1e9df', column: '#938372', safe: '#aa7851', safeSide: '#855c3f',
    hazard: '#436b82', hazardSide: '#325265', hazardDetail: '#aad7e7',
    ball: '#d3edc4', ballShadow: '#514333', particle: '#a5b883', finish: '#84914e',
    accent: '#594638', uiBackground: '#f1e9df', confetti: ['#aa7851', '#8aaec2', '#a5b883', '#d3edc4'],
  },
  {
    id: 'soft-rose-terrace', name: 'Rose Terrace', family: 'soft',
    background: '#f3e9e5', column: '#96817e', safe: '#b16d60', safeSide: '#895148',
    hazard: '#4d657f', hazardSide: '#394d63', hazardDetail: '#b7d6ea',
    ball: '#d9ecc0', ballShadow: '#543b3b', particle: '#acb680', finish: '#8a914f',
    accent: '#603f40', uiBackground: '#f3e9e5', confetti: ['#b16d60', '#93a9c3', '#acb680', '#d9ecc0'],
  },
  {
    id: 'soft-copper-cloud', name: 'Copper Cloud', family: 'soft',
    background: '#f2ece4', column: '#918678', safe: '#ac795f', safeSide: '#875d49',
    hazard: '#5c598e', hazardSide: '#454371', hazardDetail: '#c6c0f0',
    ball: '#d2e9cf', ballShadow: '#50433c', particle: '#b6b576', finish: '#98944e',
    accent: '#53483e', uiBackground: '#f2ece4', confetti: ['#ac795f', '#9e98c3', '#b6b576', '#d2e9cf'],
  },
  {
    id: 'soft-lavender-stone', name: 'Lavender Stone', family: 'soft',
    background: '#eeebf1', column: '#898398', safe: '#886eaa', safeSide: '#695585',
    hazard: '#a94f49', hazardSide: '#833b36', hazardDetail: '#f3bb96',
    ball: '#e8edb0', ballShadow: '#423d57', particle: '#bdb576', finish: '#969149',
    accent: '#4e4165', uiBackground: '#eeebf1', confetti: ['#886eaa', '#c9907f', '#bdb576', '#e8edb0'],
  },
  {
    id: 'soft-plum-paper', name: 'Plum Paper', family: 'soft',
    background: '#f0e8ed', column: '#938194', safe: '#987197', safeSide: '#765778',
    hazard: '#477862', hazardSide: '#355c4a', hazardDetail: '#b0ddae',
    ball: '#f5dfa6', ballShadow: '#4d3a50', particle: '#b2ba7e', finish: '#8d9451',
    accent: '#5b3e5a', uiBackground: '#f0e8ed', confetti: ['#987197', '#91b59c', '#b2ba7e', '#f5dfa6'],
  },
  {
    id: 'soft-iris-mist', name: 'Iris Mist', family: 'soft',
    background: '#ecebf3', column: '#83879d', safe: '#797bab', safeSide: '#5e6087',
    hazard: '#a6603e', hazardSide: '#80482f', hazardDetail: '#f2c997',
    ball: '#e6edb9', ballShadow: '#3e455a', particle: '#bcc188', finish: '#949a53',
    accent: '#44496b', uiBackground: '#ecebf3', confetti: ['#797bab', '#c59a7a', '#bcc188', '#e6edb9'],
  },
  {
    id: 'soft-mulberry-silk', name: 'Mulberry Silk', family: 'soft',
    background: '#f0e9ee', column: '#928392', safe: '#9c7090', safeSide: '#795570',
    hazard: '#417981', hazardSide: '#305c63', hazardDetail: '#a7dfe2',
    ball: '#f4e0aa', ballShadow: '#4c3d4c', particle: '#b7bb82', finish: '#959552',
    accent: '#5e4256', uiBackground: '#f0e9ee', confetti: ['#9c7090', '#8fbbc0', '#b7bb82', '#f4e0aa'],
  },
  {
    id: 'soft-honey-fog', name: 'Honey Fog', family: 'soft',
    background: '#f1eddf', column: '#928d70', safe: '#9a853f', safeSide: '#78672f',
    hazard: '#775783', hazardSide: '#593f65', hazardDetail: '#d9b7e5',
    ball: '#cde9ed', ballShadow: '#494632', particle: '#b8a366', finish: '#7c8e56',
    accent: '#514c30', uiBackground: '#f1eddf', confetti: ['#9a853f', '#b596bf', '#91b4a7', '#cde9ed'],
  },
  {
    id: 'soft-olive-porcelain', name: 'Olive Porcelain', family: 'soft',
    background: '#edeedf', column: '#889075', safe: '#879049', safeSide: '#687036',
    hazard: '#9e5366', hazardSide: '#793f50', hazardDetail: '#f2b8c6',
    ball: '#d5e8f6', ballShadow: '#414a31', particle: '#bec18b', finish: '#8f944b',
    accent: '#444e31', uiBackground: '#edeedf', confetti: ['#879049', '#c08e9b', '#bec18b', '#d5e8f6'],
  },
  {
    id: 'soft-saffron-dawn', name: 'Saffron Dawn', family: 'soft',
    background: '#f4ecdf', column: '#97896f', safe: '#a9843f', safeSide: '#856631',
    hazard: '#535f8c', hazardSide: '#3d476c', hazardDetail: '#b9c5ef',
    ball: '#d1e9e6', ballShadow: '#50432c', particle: '#b9b681', finish: '#95904d',
    accent: '#594b31', uiBackground: '#f4ecdf', confetti: ['#a9843f', '#909bbe', '#b9b681', '#d1e9e6'],
  },
  {
    id: 'soft-moss-sand', name: 'Moss Sand', family: 'soft',
    background: '#eeedde', column: '#899074', safe: '#8d8a45', safeSide: '#6c6b34',
    hazard: '#8a547c', hazardSide: '#704060', hazardDetail: '#e6bfd4',
    ball: '#cee9ed', ballShadow: '#45472f', particle: '#b6b57b', finish: '#878e4d',
    accent: '#484c32', uiBackground: '#eeedde', confetti: ['#8d8a45', '#b991a7', '#a8bc9a', '#cee9ed'],
  },
  {
    id: 'soft-blue-hour', name: 'Blue Hour', family: 'soft',
    background: '#e7edf2', column: '#7a8b9e', safe: '#5e83a5', safeSide: '#496681',
    hazard: '#a65769', hazardSide: '#803f51', hazardDetail: '#f1b7c2',
    ball: '#ffe0a4', ballShadow: '#344756', particle: '#bdab75', finish: '#99864b',
    accent: '#3b5871', uiBackground: '#e7edf2', confetti: ['#5e83a5', '#c68f9e', '#bdab75', '#ffe0a4'],
  },
  {
    id: 'soft-denim-shell', name: 'Denim Shell', family: 'soft',
    background: '#e9edf1', column: '#81899d', safe: '#6b7fa9', safeSide: '#516286',
    hazard: '#a76143', hazardSide: '#804830', hazardDetail: '#f2c396',
    ball: '#e9e8b3', ballShadow: '#3c445a', particle: '#bbb879', finish: '#98934e',
    accent: '#46516d', uiBackground: '#e9edf1', confetti: ['#6b7fa9', '#c39378', '#bbb879', '#e9e8b3'],
  },
  {
    id: 'soft-rainwater', name: 'Rainwater', family: 'soft',
    background: '#e7efef', column: '#738e99', safe: '#448aab', safeSide: '#346b86',
    hazard: '#9a596b', hazardSide: '#744253', hazardDetail: '#ecc0c9',
    ball: '#f5dfa7', ballShadow: '#2d4655', particle: '#b8b582', finish: '#918e50',
    accent: '#2e5262', uiBackground: '#e7efef', confetti: ['#448aab', '#be929f', '#b8b582', '#f5dfa7'],
  },
  {
    id: 'soft-nordic-light', name: 'Nordic Light', family: 'soft',
    background: '#e9edf0', column: '#7b8c9a', safe: '#6389a3', safeSide: '#4b6b80',
    hazard: '#a25e50', hazardSide: '#7c463c', hazardDetail: '#f0c1aa',
    ball: '#e8edbb', ballShadow: '#364953', particle: '#b9bd89', finish: '#959551',
    accent: '#3e5562', uiBackground: '#e9edf0', confetti: ['#6389a3', '#c19583', '#b9bd89', '#e8edbb'],
  },
];

// Vivid uses saturated faces, distinct opposing hazards and deeper coloured columns.
// Pale tinted backdrops leave room for the stronger surfaces without bloom.
const vivid = [
  {
    id: 'vivid-lagoon-pop', name: 'Lagoon Pop', family: 'vivid',
    background: '#e0f7f2', column: '#337e79', safe: '#00a891', safeSide: '#007865',
    hazard: '#d21779', hazardSide: '#940b54', hazardDetail: '#ff8fc6',
    ball: '#ffe34f', ballShadow: '#12463e', particle: '#ffc42b', finish: '#bd8800',
    accent: '#0c514c', uiBackground: '#e0f7f2', confetti: ['#00a891', '#f12e96', '#ffc42b', '#ffe34f'],
  },
  {
    id: 'vivid-emerald-fizz', name: 'Emerald Fizz', family: 'vivid',
    background: '#e4f7e8', column: '#397e59', safe: '#00a665', safeSide: '#007344',
    hazard: '#b918bd', hazardSide: '#820c88', hazardDetail: '#f8a0ed',
    ball: '#ffe058', ballShadow: '#17482f', particle: '#ffb621', finish: '#ae8500',
    accent: '#165035', uiBackground: '#e4f7e8', confetti: ['#00a665', '#e33ee2', '#ffb621', '#ffe058'],
  },
  {
    id: 'vivid-turquoise-twist', name: 'Turquoise Twist', family: 'vivid',
    background: '#ddf5fa', column: '#2c7d8b', safe: '#00a9bd', safeSide: '#00798d',
    hazard: '#e4383a', hazardSide: '#a51625', hazardDetail: '#ffb16f',
    ball: '#ffec60', ballShadow: '#114654', particle: '#ffca24', finish: '#b79100',
    accent: '#104d60', uiBackground: '#ddf5fa', confetti: ['#00a9bd', '#ff5750', '#ffca24', '#ffec60'],
  },
  {
    id: 'vivid-mint-circuit', name: 'Mint Circuit', family: 'vivid',
    background: '#e1f7ee', column: '#357f67', safe: '#00a982', safeSide: '#00765a',
    hazard: '#c31cbe', hazardSide: '#8a0e86', hazardDetail: '#ff9fee',
    ball: '#ffe774', ballShadow: '#124b39', particle: '#ffc131', finish: '#b88a00',
    accent: '#12553f', uiBackground: '#e1f7ee', confetti: ['#00a982', '#f044da', '#ffc131', '#ffe774'],
  },
  {
    id: 'vivid-tangerine-dash', name: 'Tangerine Dash', family: 'vivid',
    background: '#fff0de', column: '#967038', safe: '#ee7300', safeSide: '#b44e00',
    hazard: '#5630d5', hazardSide: '#39169c', hazardDetail: '#baa6ff',
    ball: '#ceffad', ballShadow: '#623407', particle: '#2ccb83', finish: '#668d16',
    accent: '#693c11', uiBackground: '#fff0de', confetti: ['#ee7300', '#8050f7', '#2ccb83', '#ceffad'],
  },
  {
    id: 'vivid-coral-surf', name: 'Coral Surf', family: 'vivid',
    background: '#ffebe5', column: '#946451', safe: '#ed563d', safeSide: '#b42f25',
    hazard: '#135ed7', hazardSide: '#093ea0', hazardDetail: '#8acfff',
    ball: '#c0ffb5', ballShadow: '#63271c', particle: '#00c6b3', finish: '#579325',
    accent: '#703a27', uiBackground: '#ffebe5', confetti: ['#ed563d', '#3986f7', '#00c6b3', '#c0ffb5'],
  },
  {
    id: 'vivid-papaya-sky', name: 'Papaya Sky', family: 'vivid',
    background: '#fff1df', column: '#95733d', safe: '#e88208', safeSide: '#ad5800',
    hazard: '#314bce', hazardSide: '#1c309a', hazardDetail: '#afc0ff',
    ball: '#baffd2', ballShadow: '#603b0e', particle: '#00c2cf', finish: '#658c19',
    accent: '#644114', uiBackground: '#fff1df', confetti: ['#e88208', '#607cf5', '#00c2cf', '#baffd2'],
  },
  {
    id: 'vivid-vermillion-bloom', name: 'Vermillion Bloom', family: 'vivid',
    background: '#ffebe2', column: '#966c48', safe: '#ed5828', safeSide: '#b43712',
    hazard: '#7427cf', hazardSide: '#501391', hazardDetail: '#d1a1ff',
    ball: '#dfff95', ballShadow: '#662d12', particle: '#91cd17', finish: '#749711',
    accent: '#713915', uiBackground: '#ffebe2', confetti: ['#ed5828', '#a150ef', '#91cd17', '#dfff95'],
  },
  {
    id: 'vivid-violet-current', name: 'Violet Current', family: 'vivid',
    background: '#f1e7ff', column: '#795a9c', safe: '#9736e6', safeSide: '#681db0',
    hazard: '#d9540b', hazardSide: '#9b3500', hazardDetail: '#ffd076',
    ball: '#dcff95', ballShadow: '#462568', particle: '#00c9d9', finish: '#7c970b',
    accent: '#542877', uiBackground: '#f1e7ff', confetti: ['#9736e6', '#ff7826', '#00c9d9', '#dcff95'],
  },
  {
    id: 'vivid-orchid-spark', name: 'Orchid Spark', family: 'vivid',
    background: '#fae5fa', column: '#8c528f', safe: '#cf2fca', safeSide: '#951a94',
    hazard: '#008775', hazardSide: '#00614f', hazardDetail: '#70f5cd',
    ball: '#ffeb72', ballShadow: '#5a275e', particle: '#00d3a4', finish: '#a28c06',
    accent: '#672b6c', uiBackground: '#fae5fa', confetti: ['#cf2fca', '#00b89b', '#00d3a4', '#ffeb72'],
  },
  {
    id: 'vivid-indigo-burst', name: 'Indigo Burst', family: 'vivid',
    background: '#ede9ff', column: '#675c9f', safe: '#6541ed', safeSide: '#4324b6',
    hazard: '#d27705', hazardSide: '#984f00', hazardDetail: '#ffdb77',
    ball: '#c8ffaa', ballShadow: '#34266d', particle: '#00c7e7', finish: '#63910c',
    accent: '#412d7d', uiBackground: '#ede9ff', confetti: ['#6541ed', '#ffad19', '#00c7e7', '#c8ffaa'],
  },
  {
    id: 'vivid-fuchsia-garden', name: 'Fuchsia Garden', family: 'vivid',
    background: '#ffe5f3', column: '#965375', safe: '#e42b9d', safeSide: '#a2176d',
    hazard: '#008b5f', hazardSide: '#006241', hazardDetail: '#8af2b4',
    ball: '#ffeb79', ballShadow: '#652047', particle: '#04cb91', finish: '#a5980a',
    accent: '#752950', uiBackground: '#ffe5f3', confetti: ['#e42b9d', '#00b977', '#04cb91', '#ffeb79'],
  },
  {
    id: 'vivid-citron-flight', name: 'Citron Flight', family: 'vivid',
    background: '#f5f7dc', column: '#80883f', safe: '#909f00', safeSide: '#6b7800',
    hazard: '#c018a4', hazardSide: '#880a76', hazardDetail: '#ff9ee3',
    ball: '#c6f0ff', ballShadow: '#414b06', particle: '#efd315', finish: '#789600',
    accent: '#46500a', uiBackground: '#f5f7dc', confetti: ['#909f00', '#ed38c4', '#00bcd9', '#c6f0ff'],
  },
  {
    id: 'vivid-golden-kite', name: 'Golden Kite', family: 'vivid',
    background: '#fff4db', column: '#987c2c', safe: '#cb9200', safeSide: '#9a6b00',
    hazard: '#5c2fd3', hazardSide: '#401895', hazardDetail: '#c1a5ff',
    ball: '#caffdf', ballShadow: '#564100', particle: '#ffc522', finish: '#738e0d',
    accent: '#604c12', uiBackground: '#fff4db', confetti: ['#cb9200', '#9253f6', '#00c7b2', '#caffdf'],
  },
  {
    id: 'vivid-lime-parade', name: 'Lime Parade', family: 'vivid',
    background: '#f0f7dc', column: '#758a39', safe: '#7ba500', safeSide: '#5b7b00',
    hazard: '#d32376', hazardSide: '#981250', hazardDetail: '#ff9ccb',
    ball: '#cbf0ff', ballShadow: '#364b09', particle: '#d5de16', finish: '#689800',
    accent: '#3e570e', uiBackground: '#f0f7dc', confetti: ['#7ba500', '#f54497', '#00c3db', '#cbf0ff'],
  },
  {
    id: 'vivid-amber-wave', name: 'Amber Wave', family: 'vivid',
    background: '#fff1d9', column: '#94772f', safe: '#d79200', safeSide: '#9c6500',
    hazard: '#215ccd', hazardSide: '#123c98', hazardDetail: '#91c3ff',
    ball: '#bdfff0', ballShadow: '#574007', particle: '#ffc727', finish: '#7b910e',
    accent: '#5e4814', uiBackground: '#fff1d9', confetti: ['#d79200', '#4788f4', '#00c8ab', '#bdfff0'],
  },
  {
    id: 'vivid-cobalt-cove', name: 'Cobalt Cove', family: 'vivid',
    background: '#e5edff', column: '#496a9d', safe: '#2465ed', safeSide: '#1346b4',
    hazard: '#dd4b20', hazardSide: '#a12d0c', hazardDetail: '#ffb473',
    ball: '#ffe775', ballShadow: '#173769', particle: '#00cfaa', finish: '#b0970a',
    accent: '#204678', uiBackground: '#e5edff', confetti: ['#2465ed', '#ff703d', '#00cfaa', '#ffe775'],
  },
  {
    id: 'vivid-azure-rush', name: 'Azure Rush', family: 'vivid',
    background: '#dff3fc', column: '#387b9a', safe: '#008dce', safeSide: '#006298',
    hazard: '#ce258c', hazardSide: '#92135f', hazardDetail: '#ff9cd7',
    ball: '#ffe764', ballShadow: '#114967', particle: '#2ed271', finish: '#a9980c',
    accent: '#14536f', uiBackground: '#dff3fc', confetti: ['#008dce', '#ef42ab', '#2ed271', '#ffe764'],
  },
  {
    id: 'vivid-sapphire-lime', name: 'Sapphire Lime', family: 'vivid',
    background: '#e8edff', column: '#56699d', safe: '#273fe8', safeSide: '#2e37ac',
    hazard: '#d67308', hazardSide: '#9c4c00', hazardDetail: '#ffcf75',
    ball: '#e1ff82', ballShadow: '#293567', particle: '#44cc54', finish: '#8fa30a',
    accent: '#344476', uiBackground: '#e8edff', confetti: ['#273fe8', '#ff9c24', '#44cc54', '#e1ff82'],
  },
  {
    id: 'vivid-sky-punch', name: 'Sky Punch', family: 'vivid',
    background: '#dff5fb', column: '#397a95', safe: '#008dbb', safeSide: '#00668b',
    hazard: '#dc2e60', hazardSide: '#9d163d', hazardDetail: '#ff9eb5',
    ball: '#fcf175', ballShadow: '#124b60', particle: '#33d297', finish: '#aba008',
    accent: '#195367', uiBackground: '#dff5fb', confetti: ['#008dbb', '#fa547e', '#33d297', '#fcf175'],
  },
];

const freezePalette = (palette) => Object.freeze({ ...palette, confetti: Object.freeze(palette.confetti) });
export const SOFT_PALETTES = Object.freeze(soft.map(freezePalette));
export const VIVID_PALETTES = Object.freeze(vivid.map(freezePalette));
export const ALL_PALETTES = Object.freeze([...SOFT_PALETTES, ...VIVID_PALETTES]);

export function normalizePaletteStyle(value) { return PALETTE_STYLES.includes(value) ? value : 'soft'; }

/** FNV-1a hashes the decimal level text, preserving even very large safe integers. */
function paletteSeed(text) {
  let seed = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    seed = Math.imul(seed ^ text.charCodeAt(index), 16777619);
  }
  seed ^= seed >>> 16;
  seed = Math.imul(seed, 0x7feb352d);
  seed ^= seed >>> 15;
  return seed >>> 0;
}

/**
 * Jump between distant hue groups, then seed one of four curated compositions.
 * The group sequence crosses its repeat boundary safely and cannot form ABAB.
 * Mixed chooses the order within each Soft/Vivid pair; its longest family run
 * is two. Selection is O(1), including a retry at a very large numbered level.
 */
export function selectPalette(levelNumber = 1, style = 'soft') {
  const number = Number.isSafeInteger(levelNumber) && levelNumber > 0 ? levelNumber : 1;
  const index = number - 1;
  let family = normalizePaletteStyle(style);
  if (family === 'mixed') {
    const reverse = paletteSeed(`${PALETTE_VERSION}:family:${Math.floor(index / 2)}`) % 2;
    family = (index % 2 + reverse) % 2 === 0 ? 'soft' : 'vivid';
  }
  const group = [0, 2, 3, 4, 1][index % 5];
  const variation = paletteSeed(`${PALETTE_VERSION}:${family}:${Math.floor(index / 5)}:${group}`) % 4;
  return (family === 'vivid' ? VIVID_PALETTES : SOFT_PALETTES)[group * 4 + variation];
}

/** Palette data deliberately uses full hexadecimal colours for unambiguous parsing. */
export function parsePaletteColor(value) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return null;
  return [1, 3, 5].map((start) => parseInt(value.slice(start, start + 2), 16) / 255);
}

function luminance(rgb) {
  const linear = rgb.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function hueAndSaturation(rgb) {
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  const delta = max - min;
  if (delta < 1e-8) return { hue: 0, saturation: 0 };
  let hue = max === rgb[0] ? (rgb[1] - rgb[2]) / delta
    : max === rgb[1] ? 2 + (rgb[2] - rgb[0]) / delta : 4 + (rgb[0] - rgb[1]) / delta;
  hue = ((hue * 60) % 360 + 360) % 360;
  return { hue, saturation: delta / max };
}

export function colorSeparation(first, second) {
  const a = parsePaletteColor(first);
  const b = parsePaletteColor(second);
  if (!a || !b) return null;
  const lightA = luminance(a);
  const lightB = luminance(b);
  const hueA = hueAndSaturation(a);
  const hueB = hueAndSaturation(b);
  const hueDelta = Math.abs(hueA.hue - hueB.hue);
  return {
    contrast: (Math.max(lightA, lightB) + 0.05) / (Math.min(lightA, lightB) + 0.05),
    hueDistance: Math.min(hueDelta, 360 - hueDelta),
    minimumSaturation: Math.min(hueA.saturation, hueB.saturation),
    colorDistance: Math.hypot(...a.map((channel, index) => channel - b[index])),
    luminanceDifference: Math.abs(lightA - lightB),
  };
}

/** Contrast is a baseline; hue plus the hazard's sculpted pattern also matter in 3D. */
export function validatePalette(palette) {
  const errors = [];
  const metrics = {};
  if (!palette || typeof palette !== 'object') return { valid: false, errors: ['Palette must be an object'], metrics };
  if (!palette.id || !palette.name || !['soft', 'vivid'].includes(palette.family)) errors.push('Palette identity/family is missing');
  for (const field of PALETTE_COLOR_FIELDS) {
    if (!parsePaletteColor(palette[field])) errors.push(`Invalid colour: ${field}`);
  }
  if (!Array.isArray(palette.confetti) || palette.confetti.length < 3 || palette.confetti.some((color) => !parsePaletteColor(color))) {
    errors.push('Confetti needs at least three valid colours');
  }
  if (errors.length) return { valid: false, errors, metrics };
  metrics.safeHazard = colorSeparation(palette.safe, palette.hazard);
  const surface = metrics.safeHazard;
  if (surface.contrast < PALETTE_LIMITS.surfaceContrast
    && !(surface.hueDistance >= PALETTE_LIMITS.surfaceHueSeparation && surface.minimumSaturation >= 0.2 && surface.colorDistance >= 0.28)) {
    errors.push('Safe/hazard colours need stronger luminance or hue separation');
  }
  for (const field of ['column', 'safe', 'hazard']) {
    metrics[`ball-${field}`] = colorSeparation(palette.ball, palette[field]);
    if (metrics[`ball-${field}`].contrast < PALETTE_LIMITS.ballContrast) errors.push(`Ball/${field} contrast is too low`);
  }
  metrics.interface = colorSeparation(palette.accent, palette.uiBackground);
  if (metrics.interface.contrast < PALETTE_LIMITS.interfaceContrast) errors.push('Interface text contrast is too low');
  metrics.background = colorSeparation(palette.background, palette.column);
  if (metrics.background.contrast < PALETTE_LIMITS.backgroundContrast) errors.push('Column/background contrast is too low');
  for (const kind of ['safe', 'hazard']) {
    if (colorSeparation(palette[kind], palette[`${kind}Side`]).luminanceDifference < 0.015) errors.push(`${kind} bevel needs depth contrast`);
  }
  return { valid: errors.length === 0, errors, metrics };
}

export function arePalettesSimilar(first, second) {
  if (first.id === second.id) return true;
  const safe = colorSeparation(first.safe, second.safe);
  return safe.hueDistance < 45 && safe.colorDistance < 0.35;
}

// Fail descriptively while loading authored data; generated levels never render
// an invalid palette, and validation is not repeated inside the frame loop.
for (const palette of ALL_PALETTES) {
  const result = validatePalette(palette);
  if (!result.valid) throw new Error(`Invalid palette ${palette.id}: ${result.errors.join('; ')}`);
}
