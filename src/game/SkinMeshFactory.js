import * as THREE from 'three';
import { CONFIG } from './config.js';
import { getSkinDefinition, SKIN_VISUAL_ENVELOPE } from './SkinCatalog.js';
import { colorSeparation } from './PaletteManager.js';

const RADIUS = CONFIG.physics.ballRadius;

function normalizeGeometry(geometry, radius = RADIUS) {
  const positions = geometry.attributes.position;
  let maximum = 0;
  for (let index = 0; index < positions.count; index++) maximum = Math.max(maximum, Math.hypot(positions.getX(index), positions.getY(index), positions.getZ(index)));
  geometry.scale(radius / maximum, radius / maximum, radius / maximum);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function sculptedGeometry(kind) {
  if (kind === 'prism') return new THREE.IcosahedronGeometry(RADIUS, 1);
  if (kind === 'facet') return new THREE.IcosahedronGeometry(.29, 0);
  if (kind === 'crystal') {
    const geometry = new THREE.IcosahedronGeometry(1, 0);
    geometry.scale(.92, 1.07, .97);
    return normalizeGeometry(geometry, .29);
  }
  if (kind === 'disco' || kind === 'paint') return new THREE.SphereGeometry(RADIUS, 16, 12).toNonIndexed();
  if (kind === 'duo') return new THREE.IcosahedronGeometry(RADIUS, 1);
  const geometry = new THREE.SphereGeometry(RADIUS, 24, 18);
  if (kind === 'sphere' || kind === 'glass' || kind === 'jelly') return geometry;
  const positions = geometry.attributes.position;
  for (let index = 0; index < positions.count; index++) {
    let x = positions.getX(index) / RADIUS, y = positions.getY(index) / RADIUS, z = positions.getZ(index) / RADIUS;
    if (kind === 'rounded-cube' || kind === 'twist') {
      // A sphere-to-superellipsoid map gives broad rounded faces without an
      // imported model. Twist rotates horizontal slices of that original form.
      x = Math.sign(x) * Math.abs(x) ** .60;
      y = Math.sign(y) * Math.abs(y) ** .60;
      z = Math.sign(z) * Math.abs(z) ** .60;
      if (kind === 'twist') {
        const angle = y * .80, cosine = Math.cos(angle), sine = Math.sin(angle);
        const previousX = x;
        x = previousX * cosine - z * sine;
        z = previousX * sine + z * cosine;
      }
    } else if (kind === 'capsule') { x *= .86; z *= .86; y *= 1.07; }
    positions.setXYZ(index, x, y, z);
  }
  return normalizeGeometry(geometry, kind === 'capsule' ? .287 : .30);
}

function rgb(hex) { return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)); }

/** Small original pixel patterns, generated once. Works in browsers and Node;
 * neither an image download nor Canvas/OffscreenCanvas support is required. */
function makePattern(kind, palette) {
  const width = 128, height = 64, bytes = new Uint8Array(width * height * 4);
  const colors = palette.map(rgb);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height;
    let first = 0, second = 0, amount = 0, shade = 1;
    if (kind === 'marble') {
      const wave = Math.sin(u * 24 + Math.sin(v * 15) * 3.5 + Math.sin((u + v) * 9));
      first = 0; second = 1; amount = Math.max(0, 1 - Math.abs(wave) * 7) * .70;
    } else if (kind === 'panels') {
      const slanted = (u * 6 + Math.sin(v * Math.PI * 2) * .5) % 1;
      first = Math.floor(u * 6 + Math.sin(v * Math.PI * 2) * .5) % 2 === 0 ? 0 : 1;
      if (slanted < .026 || slanted > .974 || Math.abs(v - .5) < .012) shade = .58;
    } else if (kind === 'split') first = u < .50 ? 0 : 1;
    else if (kind === 'chrome') {
      first = 0; second = 1;
      amount = .20 + .72 * Math.exp(-(((v - .51) / .105) ** 2));
      shade = .94 + .06 * Math.sin(u * Math.PI * 2);
    } else if (kind === 'disco') {
      const column = Math.floor(u * 16), row = Math.floor(v * 12);
      first = ((column * 7 + row * 11) % 9) % colors.length;
      shade = .72 + ((column * 13 + row * 3) % 7) * .045;
      if ((u * 16) % 1 < .065 || (v * 12) % 1 < .065) shade *= .64;
    } else if (kind === 'spectrum') first = Math.floor((v + .12 * Math.sin(u * Math.PI * 2)) * 7 + 7) % colors.length;
    else if (kind === 'patchwork') {
      const column = Math.floor(u * 9 + Math.sin(v * 20) * .35), row = Math.floor(v * 6);
      first = ((column * 5 + row * 7) % colors.length + colors.length) % colors.length;
    } else if (kind === 'obsidian') {
      // Intersecting warped fracture paths, baked once rather than animated
      // noise. Wide gold fissures stay legible at the gameplay ball's size.
      const a = Math.abs(Math.sin(u * 19 + Math.sin(v * 17) * 1.9));
      const b = Math.abs(Math.sin(v * 17 + Math.sin(u * 15) * 2.0));
      const line = Math.min(a, b);
      first = 0; second = line < .065 ? 1 : 2;
      amount = Math.max(0, 1 - line / .16);
      if (line < .065) amount = .86 + .14 * (1 - line / .065);
    } else if (kind === 'nebula') {
      const cloud = Math.sin(u * 11 + Math.sin(v * 8) * 2.6) * .38 + Math.sin(v * 17 - u * 8) * .22;
      first = cloud > .05 ? 1 : 0; second = 2;
      amount = Math.max(0, Math.sin(u * 18 + v * 11 + cloud * 5)) * .63;
      shade = .52 + .48 * Math.max(0, Math.cos(v * 7 - u * 10));
      if (((x * 73 + y * 137 + x * y * 7) % 997) < 3) { first = 2; second = 2; shade = 2.7; }
    } else if (kind === 'aurora') {
      const ribbon = Math.sin(u * 12 + v * 5 + Math.sin(v * 12) * 1.3);
      first = ribbon > .22 ? 0 : ribbon > -.42 ? 1 : 2;
      second = (first + 1) % colors.length;
      amount = Math.max(0, Math.sin(u * 18 - v * 11)) * .32;
      shade = .22 + .78 * Math.pow(.5 + .5 * Math.sin(v * 16 + Math.sin(u * 9) * 2.3), .55);
    }
    const a = colors[first] || colors[0], b = colors[second] || a, offset = (y * width + x) * 4;
    for (let channel = 0; channel < 3; channel++) bytes[offset + channel] = Math.min(255, Math.round((a[channel] * (1 - amount) + b[channel] * amount) * shade));
    bytes[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export const PREMIUM_VISUAL_LIMITS = Object.freeze({ maximumDraws: 4, textureWidth: 128, textureHeight: 64, plasmaBranches: 12, plasmaSegmentsPerBranch: 8 });

const surfaceVertex = `
varying vec3 skinNormal;
varying vec3 skinView;
varying vec3 skinLocal;
varying vec2 skinUv;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  skinNormal = normalize(normalMatrix * normal);
  skinView = -mv.xyz;
  skinLocal = position;
  skinUv = uv;
  gl_Position = projectionMatrix * mv;
}`;

// Analytic studio reflections use a few broad, moving light bands. They remain
// convincing on a tiny ball without a cube camera, extra lights or bloom. The
// surface never changes geometry, collision, tower lighting or scene exposure.
const surfacePrelude = `
uniform float skinTime;
uniform float skinCharge;
uniform sampler2D skinPattern;
varying vec3 skinNormal;
varying vec3 skinView;
varying vec3 skinLocal;
varying vec2 skinUv;
float band(float value, float centre, float width) {
  return exp(-pow((value - centre) / width, 2.0));
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 n = normalize(skinNormal);
  vec3 view = normalize(skinView);
  vec3 reflected = reflect(-view, n);
  float facing = max(0.0, dot(n, view));
  float edge = pow(1.0 - facing, 2.5);
  float light = .36 + .64 * max(0.0, dot(n, normalize(vec3(-.45, .7, 1.0))));
  float drift = sin(skinTime * .35) * .10;
  float strip = band(reflected.x + reflected.y * .31, -.43 + drift, .13);
  float glint = pow(max(0.0, dot(reflected, normalize(vec3(-.45, .7, 1.0)))), 60.0);
  vec3 color = vec3(0.0);
  float alpha = 1.0;
`;

const surfaceBodies = {
  'auric-gold': `
  float horizon = smoothstep(-.25, .62, reflected.y);
  color = mix(vec3(.24, .055, .006), vec3(1.0, .60, .08), horizon);
  color = mix(color, vec3(.045, .015, .003), band(reflected.y, -.10 + drift * .3, .12) * .80);
  color = mix(color, vec3(1.0, .93, .65), strip * .93);
  color += vec3(1.0, .74, .24) * band(reflected.y, .67, .10) * .55;
  color += vec3(1.0, .93, .72) * glint * 1.7;
  color += vec3(.54, .22, .02) * edge;
  float fleck = step(.988, hash(floor(skinUv * vec2(72.0, 36.0))));
  color += vec3(1.0, .88, .48) * fleck * pow(max(0.0, sin(skinTime * 1.4 + skinUv.x * 28.0)), 10.0) * .13;
`,
  'plasma-core': `
  color = mix(vec3(.016, .027, .11), vec3(.07, .20, .46), edge);
  color += vec3(.22, .42, .82) * strip * .26;
  color += vec3(.30, .68, 1.0) * glint * .75;
  alpha = .10 + edge * .40 + glint * .18;
`,
  'pearl-shift': `
  float shift = dot(reflected, vec3(.72, .46, .32)) * 5.0 + sin(skinTime * .24) * .35;
  vec3 sheen = .5 + .5 * cos(vec3(0.0, 2.1, 4.2) + shift);
  color = mix(vec3(.58, .54, .69), sheen, .38 + edge * .38) * light;
  color += vec3(.56, .58, .62) * strip * .72 + vec3(.95, .88, .98) * glint * 1.3;
  color += sheen * edge * .26;
`,
  'prism': `
  float region = mod(floor(skinUv.x * 11.0 + skinUv.y * 7.0), 6.0);
  color = region < 1.0 ? vec3(.01, .66, 1.0) : region < 2.0 ? vec3(.74, .015, .40) :
    region < 3.0 ? vec3(1.0, .56, .02) : region < 4.0 ? vec3(.04, .88, .42) :
    region < 5.0 ? vec3(.37, .015, .82) : vec3(.02, .23, .95);
  color *= .36 + light * .85;
  color += vec3(.70, .82, 1.0) * strip * .70 + vec3(1.0) * glint;
`,
  'obsidian-vein': `
  color = texture2D(skinPattern, skinUv).rgb;
  float molten = smoothstep(.08, .52, color.r);
  color *= .56 + light * .46;
  color += vec3(.18, .23, .33) * strip * .70 + vec3(.90, .88, .74) * glint;
  color += vec3(.50, .16, .012) * molten * (.45 + .08 * sin(skinTime * .6));
  color += vec3(.035, .045, .075) * edge;
`,
  'nebula': `
  color = texture2D(skinPattern, skinUv).rgb * (.60 + light * .52);
  float star = step(.995, hash(floor(skinUv * vec2(64.0, 32.0))));
  color += vec3(.70, .82, 1.0) * star * (.55 + .20 * sin(skinTime * .8 + skinUv.y * 21.0));
  color += vec3(.50, .33, .86) * edge * .24 + vec3(.86, .73, 1.0) * glint * .70;
  color += vec3(.19, .24, .50) * strip * .28;
`,
  'aurora': `
  vec2 flow = skinUv + vec2(sin(skinTime * .23) * .035, 0.0);
  color = texture2D(skinPattern, flow).rgb * (.70 + light * .48);
  color += vec3(.08, .51, .37) * edge * .32;
  color += vec3(.52, 1.0, .85) * strip * .33 + vec3(.79, .97, 1.0) * glint * .95;
`,
};

function premiumMaterial(skin, pattern) {
  const material = new THREE.ShaderMaterial({
    uniforms: { skinTime: { value: 0 }, skinCharge: { value: 0 }, skinPattern: { value: pattern || null } },
    vertexShader: surfaceVertex,
    fragmentShader: `${surfacePrelude}${surfaceBodies[skin.id]}
      color += vec3(.09, .12, .16) * skinCharge;
      gl_FragColor = vec4(color, alpha);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
    transparent: skin.id === 'plasma-core', depthWrite: skin.id !== 'plasma-core',
  });
  material.name = `${skin.name} procedural surface`;
  return material;
}

function plasmaFilaments() {
  const positions = [], phases = [], colors = [];
  const cyan = new THREE.Color('#41eaff'), violet = new THREE.Color('#a748ff');
  const start = new THREE.Vector3(), end = new THREE.Vector3(), direction = new THREE.Vector3();
  const emit = (a, b, phase, color) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    phases.push(phase, phase); colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
  };
  for (let branch = 0; branch < PREMIUM_VISUAL_LIMITS.plasmaBranches; branch++) {
    const y = 1 - (branch + .5) / PREMIUM_VISUAL_LIMITS.plasmaBranches * 2;
    const angle = branch * 2.3999632297, radial = Math.sqrt(1 - y * y);
    direction.set(Math.cos(angle) * radial, y, Math.sin(angle) * radial);
    const color = branch % 3 === 0 ? violet : cyan;
    start.copy(direction).multiplyScalar(.055);
    for (let segment = 1; segment <= 6; segment++) {
      const distance = .055 + segment * .031;
      end.copy(direction).multiplyScalar(distance);
      end.x += Math.sin(branch * 3 + segment * 2.3) * .023 * (1 - distance / .28);
      end.y += Math.cos(branch + segment * 2.1) * .023 * (1 - distance / .28);
      emit(start, end, branch * 1.7, color); start.copy(end);
    }
    // A two-segment fork on each main hair gives a plasma-lamp identity with
    // one line draw and 192 vertices; animation remains on the GPU.
    start.copy(direction).multiplyScalar(.16);
    end.copy(direction).multiplyScalar(.20); end.x += Math.sin(angle) * .039; end.z += Math.cos(angle) * .039;
    emit(start, end, branch * 1.7 + .6, violet); start.copy(end);
    end.multiplyScalar(1.12); emit(start, end, branch * 1.7 + .6, cyan);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('skinPhase', new THREE.Float32BufferAttribute(phases, 1));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function filamentMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { skinTime: { value: 0 }, skinCharge: { value: 0 } },
    transparent: true, depthWrite: false, vertexColors: true, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float skinTime; attribute float skinPhase; varying vec3 filamentColor;
      void main() {
        vec3 p = position;
        float radius = length(p);
        float wiggle = .013 * (1.0 - radius / .27);
        p += vec3(sin(skinTime * 2.8 + skinPhase + radius * 31.0), cos(skinTime * 2.1 + skinPhase + radius * 27.0), 0.0) * wiggle;
        p = normalize(p) * radius;
        filamentColor = color;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `uniform float skinCharge; varying vec3 filamentColor;
      void main() {
        gl_FragColor = vec4(filamentColor * (1.08 + skinCharge * .22), .92);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** The cache owns GPU resources; instances only own transforms. Equipping or
 * closing a shop therefore releases a group without destroying shared assets. */
export class SkinMeshFactory {
  constructor() { this.entries = new Map(); this.instances = new Set(); this.disposed = false; }

  getEntry(id) {
    if (this.disposed) throw new Error('Skin factory is disposed');
    const skin = getSkinDefinition(id);
    if (this.entries.has(skin.id)) return this.entries.get(skin.id);
    const geometries = new Set(), materials = new Set(), textures = new Set();
    const prototype = new THREE.Group();
    const geometry = item => { geometries.add(item); return item; };
    const material = item => { materials.add(item); return item; };
    let pattern = null;
    if (skin.texture) { pattern = makePattern(skin.texture, skin.material.colors); textures.add(pattern); }
    const primary = material(skin.tier === 'premium' ? premiumMaterial(skin, pattern) : new THREE.MeshStandardMaterial({
      color: skin.texture ? '#ffffff' : skin.material.colors[0], roughness: skin.material.roughness ?? .32,
      metalness: skin.material.metalness ?? .05, emissive: skin.material.colors[0], emissiveIntensity: .025,
      transparent: Boolean(skin.material.opacity), opacity: skin.material.opacity ?? 1,
      depthWrite: !skin.material.opacity, flatShading: ['facet', 'crystal', 'disco', 'paint', 'duo'].includes(skin.geometry.type),
    }));
    if (pattern && skin.tier !== 'premium') primary.map = pattern;
    const accent = () => material(new THREE.MeshStandardMaterial({ color: skin.material.colors[1] || skin.material.colors[0], roughness: .32, metalness: .22, emissive: skin.material.colors[1] || skin.material.colors[0], emissiveIntensity: .04 }));
    const add = (shape, surface = primary) => { const mesh = new THREE.Mesh(geometry(shape), surface); prototype.add(mesh); return mesh; };
    const kind = skin.geometry.type;
    let body;
    if (kind === 'plasma') {
      body = add(new THREE.SphereGeometry(RADIUS, 24, 18));
      body.renderOrder = 3;
      const core = add(new THREE.SphereGeometry(.075, 16, 12), material(new THREE.MeshBasicMaterial({ color: '#a2f5ff' })));
      core.name = 'plasma-inner-core';
      const filaments = new THREE.LineSegments(geometry(plasmaFilaments()), material(filamentMaterial()));
      filaments.name = 'plasma-branching-filaments'; filaments.renderOrder = 2;
      prototype.add(filaments);
    } else if (kind === 'halo') {
      body = add(new THREE.TorusGeometry(.195, .08, 10, 32));
      add(new THREE.SphereGeometry(.175, 18, 12), accent());
    } else if (kind === 'orbit') {
      body = add(new THREE.SphereGeometry(.229, 24, 18));
      const ring = add(new THREE.TorusGeometry(.257, .018, 6, 40), accent());
      ring.rotation.set(.85, .15, .2);
    } else if (kind === 'neon') {
      primary.emissiveIntensity = .65;
      body = add(new THREE.SphereGeometry(.238, 20, 14));
      const ribs = accent();
      for (let index = 0; index < 3; index++) {
        const ring = add(new THREE.TorusGeometry(.261, .014, 5, 28), ribs);
        ring.rotation.set(index === 0 ? Math.PI / 2 : 0, index === 1 ? Math.PI / 2 : 0, 0);
      }
    } else {
      body = add(sculptedGeometry(kind));
      if (kind === 'prism') body.geometry.computeVertexNormals();
      if (kind === 'glass') add(new THREE.SphereGeometry(.17, 16, 12), accent());
    }
    // Thin original silhouette edge for fixed colours, especially transparent
    // materials. No shell is added to Classic, whose rendering stays unchanged.
    if (!skin.paletteAdaptive) {
      const edge = material(new THREE.MeshBasicMaterial({ color: '#263b4b', side: THREE.BackSide }));
      const outline = new THREE.Mesh(body.geometry, edge);
      outline.scale.setScalar(1.009);
      prototype.add(outline);
    }
    prototype.updateMatrixWorld(true);
    let radius = 0;
    const point = new THREE.Vector3();
    prototype.traverse(object => {
      const positions = object.geometry?.attributes.position;
      if (!positions) return;
      for (let index = 0; index < positions.count; index++) {
        point.fromBufferAttribute(positions, index).applyMatrix4(object.matrixWorld);
        radius = Math.max(radius, point.length());
      }
    });
    if (radius > SKIN_VISUAL_ENVELOPE) throw new Error(`Skin exceeds visual envelope: ${skin.id}`);
    const entry = { skin, prototype, geometries, materials, textures, primary, radius };
    this.entries.set(skin.id, entry);
    return entry;
  }

  create(id, palette) {
    const entry = this.getEntry(id), group = entry.prototype.clone(true);
    group.userData.skin = entry.skin;
    group.userData.skinResource = entry;
    group.userData.visualRadius = entry.radius;
    this.instances.add(group);
    this.setPalette(group, palette);
    return group;
  }

  setPalette(group, palette) {
    const entry = group?.userData.skinResource;
    if (!entry || !entry.skin.paletteAdaptive || !palette?.ball) return;
    entry.primary.color.set(palette.ball);
    entry.primary.emissive.set(palette.ball);
  }

  setEmissive(group, smashReady) {
    const entry = group?.userData.skinResource;
    if (!entry) return;
    if (entry.skin.tier === 'premium') {
      for (const surface of entry.materials) if (surface.uniforms?.skinCharge) surface.uniforms.skinCharge.value = smashReady ? 1 : 0;
      return;
    }
    const baseline = entry.skin.geometry.type === 'neon' ? .65 : .025;
    entry.primary.emissiveIntensity = smashReady ? Math.max(.65, baseline) : baseline;
  }

  updateSurface(group, time) {
    const entry = group?.userData.skinResource;
    if (entry?.skin.tier !== 'premium') return;
    const seconds = Number.isFinite(time) ? time : 0;
    for (const surface of entry.materials) if (surface.uniforms?.skinTime) surface.uniforms.skinTime.value = seconds;
  }

  release(group) { if (!group) return; group.removeFromParent(); this.instances.delete(group); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const instance of this.instances) instance.removeFromParent();
    this.instances.clear();
    for (const entry of this.entries.values()) {
      for (const item of entry.geometries) item.dispose();
      for (const item of entry.materials) item.dispose();
      for (const item of entry.textures) item.dispose();
    }
    this.entries.clear();
  }
}

export function skinReadability(skin, palette) {
  const colors = skin.paletteAdaptive ? [palette.ball] : skin.material.colors;
  const surfaces = ['column', 'safe', 'hazard'];
  return Object.fromEntries(surfaces.map(field => [field, {
    bestColorContrast: Math.max(...colors.map(color => colorSeparation(color, palette[field]).contrast)),
    edgeContrast: skin.paletteAdaptive ? null : colorSeparation('#263b4b', palette[field]).contrast,
    hasContactShadow: true,
  }]));
}
