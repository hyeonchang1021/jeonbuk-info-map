/* Shared RB F1 car model: geometry, livery, materials and decals.
 * Classic script (works from file:// too). Usage:
 *   const F = createF1({ THREE, BGU, RoundedBoxGeometry, DecalGeometry, scene, MAX_ANISO, isMobile, detail });
 *   F.car  → THREE.Group, forward = +x, ground at y = 0, metres.
 */
window.createF1 = function createF1(deps) {
const { THREE, BGU, RoundedBoxGeometry, DecalGeometry, scene, MAX_ANISO, isMobile } = deps;
// =====================================================================
// Helpers
// =====================================================================
function canvasTex(w, h, draw, { srgb = true, repeat = null } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAX_ANISO;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
// Geometry density (phones get roughly half the subdivisions)
const DETAIL = deps.detail ?? (isMobile ? 0.55 : 1);
const q = (n) => Math.max(8, Math.round(n * DETAIL));
// ---- procedural noise (tileable value noise + fbm) and a seeded RNG
function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, px = 1 << 30, py = 1 << 30) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const m = (a, p) => ((a % p) + p) % p;
  const x0 = m(xi, px), x1 = m(xi + 1, px), y0 = m(yi, py), y1 = m(yi + 1, py);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(x0, y0), b = hash2(x1, y0), c = hash2(x0, y1), d = hash2(x1, y1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct = 3, px = 1 << 30, py = 1 << 30) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) { sum += amp * vnoise(x * f, y * f, px * f, py * f); norm += amp; amp *= 0.5; f *= 2; }
  return sum / norm;
}
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// Height field → tangent-space normal map (OpenGL convention: +Y = up in UV space).
function heightToNormal(H, w, h, strength, { wrap = true, repeat = null } = {}) {
  return canvasTex(w, h, (ctx) => {
    const img = ctx.createImageData(w, h), d = img.data;
    const at = (x, y) => {
      if (wrap) { x = (x + w) % w; y = (y + h) % h; } else { x = x < 0 ? 0 : x >= w ? w - 1 : x; y = y < 0 ? 0 : y >= h ? h - 1 : y; }
      return H[y * w + x];
    };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const nx = -(at(x + 1, y) - at(x - 1, y)) * strength;
      const ny = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(nx, ny, 1);
      const k = (y * w + x) * 4;
      d[k] = (nx / l * 0.5 + 0.5) * 255; d[k + 1] = (ny / l * 0.5 + 0.5) * 255; d[k + 2] = (0.5 / l + 0.5) * 255; d[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, { srgb: false, repeat });
}
function canvasHeight(canvas) {
  const w = canvas.width, h = canvas.height, d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const H = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) H[i] = d[i * 4] / 255;
  return H;
}
const catmull = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
};
function sampleStations(st, f) {
  const i = Math.min(Math.floor(f), st.length - 2), t = f - i;
  const g = (k) => st[Math.max(0, Math.min(st.length - 1, k))];
  const out = {};
  for (const key in st[0]) out[key] = catmull(g(i - 1)[key], g(i)[key], g(i + 1)[key], g(i + 2)[key], t);
  return out;
}
// Super-ellipse cross-section. theta = -PI/2 is the bottom (texture seam lives there).
function sectionPoint(s, th) {
  const c = Math.cos(th), sn = Math.sin(th);
  const top = sn >= 0;
  const n = top ? s.nT : s.nB;
  let z = s.w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
  if (!top && s.uc > 0.001 && c > 0) z *= 1 - s.uc * Math.pow(-sn, 0.75);   // sidepod undercut
  let y = top ? s.yM + (s.yT - s.yM) * Math.pow(sn, 2 / n)
              : s.yM - (s.yM - s.yB) * Math.pow(-sn, 2 / n);
  if (top && s.dip > 0.002) {
    const q = Math.abs(z) / s.dipW;
    if (q < 1) y -= s.dip * (1 - Math.pow(q, 5));
  }
  return [z + (s.zc || 0), y];
}

// Loft a smooth body through a list of stations. Returns { geo, startRing, endRing }.
function loft(stations, { slices = 180, segs = 144, side = 1 } = {}) {
  const pos = [], uv = [], idx = [];
  const rings = [];
  for (let i = 0; i <= slices; i++) {
    const s = sampleStations(stations, (i / slices) * (stations.length - 1));
    const ring = [];
    for (let j = 0; j <= segs; j++) {
      const v = j / segs;
      const [z, y] = sectionPoint(s, -Math.PI / 2 + v * Math.PI * 2);
      pos.push(s.x, y, z * side);
      uv.push(i / slices, v);
      ring.push(new THREE.Vector3(s.x, y, z * side));
    }
    rings.push(ring);
  }
  const W = segs + 1;
  for (let i = 0; i < slices; i++) for (let j = 0; j < segs; j++) {
    const a = i * W + j, b = a + W;
    if (side > 0) idx.push(a, a + 1, b, a + 1, b + 1, b);
    else idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // weld normals across the UV seam
  const n = geo.attributes.normal;
  for (let i = 0; i <= slices; i++) {
    const a = i * W, b = a + segs;
    const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
  }
  return { geo, startRing: rings[0], endRing: rings[slices] };
}
function capGeometry(ring, outward) {
  const c = new THREE.Vector3();
  ring.forEach((p) => c.add(p)); c.divideScalar(ring.length);
  const pos = [c.x, c.y, c.z];
  ring.forEach((p) => pos.push(p.x, p.y, p.z));
  const idx = [];
  for (let j = 1; j < ring.length; j++) idx.push(0, j, j + 1 > ring.length ? 1 : j + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx.filter((_, k) => true));
  g.computeVertexNormals();
  // orient so the cap faces `outward`
  const nn = g.attributes.normal;
  if (nn.getX(0) * outward.x + nn.getY(0) * outward.y + nn.getZ(0) * outward.z < 0) {
    const ix = g.index.array;
    for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; }
    g.computeVertexNormals();
  }
  return g;
}
// Paint a texture pixel by pixel for a lofted surface.
function paintLoft(stations, w, h, colorFn) {
  return canvasTex(w, h, (ctx) => {
    const img = ctx.createImageData(w, h);
    const d = img.data;
    for (let px = 0; px < w; px++) {
      const u = (px + 0.5) / w;
      const s = sampleStations(stations, u * (stations.length - 1));
      for (let py = 0; py < h; py++) {
        let r = 0, g = 0, b = 0;
        for (let sy = 0; sy < 3; sy++) {
          const v = 1 - (py + (sy + 0.5) / 3) / h;
          const th = -Math.PI / 2 + v * Math.PI * 2;
          const [z, y] = sectionPoint(s, th);
          const col = colorFn(s, th, z, y);
          r += col[0]; g += col[1]; b += col[2];
        }
        const k = (py * w + px) * 4;
        d[k] = r / 3; d[k + 1] = g / 3; d[k + 2] = b / 3; d[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}
function bakeLoftHeight(stations, w, h, fn) {
  const H = new Float32Array(w * h);
  for (let px = 0; px < w; px++) {
    const s = sampleStations(stations, ((px + 0.5) / w) * (stations.length - 1));
    const perim = Math.PI * (s.w + (s.yT - s.yB) * 0.5);
    for (let py = 0; py < h; py++) {
      const v = 1 - (py + 0.5) / h;
      const th = -Math.PI / 2 + v * Math.PI * 2;
      const [z, y] = sectionPoint(s, th);
      H[py * w + px] = fn(s, th, z, y, v * perim);
    }
  }
  return H;
}
// Surface-detail primitives (heights): engraved shut line and a Dzus fastener
const groove = (d, wd = 0.0018) => -Math.exp(-(d * d) / (wd * wd));
const fastener = (d) => -0.75 * Math.exp(-(d * d) / (0.0032 * 0.0032)) + 0.22 * Math.exp(-((d - 0.0052) ** 2) / (0.0011 * 0.0011));
const modc = (a, p) => ((a % p) + p) % p - p / 2;
// NACA-style cambered aerofoil, leading edge at origin, trailing edge toward -x.
function aerofoilShape(chord, thick = 0.1, camber = 0.05) {
  const N = 80, up = [], lo = [];
  for (let i = 0; i <= N; i++) {
    const t = (1 - Math.cos((i / N) * Math.PI)) / 2;
    const yt = 5 * thick * chord * (0.2969 * Math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1036 * t ** 4);
    const yc = -camber * chord * 4 * t * (1 - t); // inverted camber → downforce
    up.push([-t * chord, yc + yt]);
    lo.push([-t * chord, yc - yt]);
  }
  const sh = new THREE.Shape();
  sh.moveTo(up[0][0], up[0][1]);
  for (let i = 1; i <= N; i++) sh.lineTo(up[i][0], up[i][1]);
  for (let i = N - 1; i >= 1; i--) sh.lineTo(lo[i][0], lo[i][1]);
  sh.closePath();
  return sh;
}
// A wing element: span along z, positioned with leading edge at (x, y), pitched by aoa (deg, TE up).
function wingElement({ chord, thick = 0.1, camber = 0.05, aoa = 0, span, x, y, warp = () => 0, sweep = () => 0, zOff = 0, stripe = null, unitUV = false }) {
  let g = new THREE.ExtrudeGeometry(aerofoilShape(chord, thick, camber), { depth: span, bevelEnabled: false, curveSegments: 1, steps: q(200) });
  { const pp = g.attributes.position, tc = new Float32Array(pp.count * 2);
    for (let i = 0; i < pp.count; i++) { tc[i * 2] = -pp.getX(i) / chord; tc[i * 2 + 1] = pp.getZ(i) / span; }
    g.setAttribute('tc', new THREE.BufferAttribute(tc, 2)); }
  g.translate(0, 0, -span / 2);
  g.rotateZ(-THREE.MathUtils.degToRad(aoa));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    p.setXYZ(i, p.getX(i) + x + sweep(z), p.getY(i) + y + warp(z), z + zOff);
  }
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = BGU.mergeVertices(g, 1e-5);
  g.computeVertexNormals();
  // planar UVs (metres) so paint and carbon detail maps have a stable scale
  const pp = g.attributes.position, uv = new Float32Array(pp.count * 2), tc = g.attributes.tc;
  for (let i = 0; i < pp.count; i++) {
    if (unitUV) { uv[i * 2] = tc.getX(i); uv[i * 2 + 1] = tc.getY(i); }
    else { uv[i * 2] = pp.getX(i) + pp.getY(i) * 0.5; uv[i * 2 + 1] = pp.getZ(i); }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (stripe) {   // stripe = [from, to, baseHex, stripeHex] in chord fraction
    const a = new THREE.Color(stripe[2]), b = new THREE.Color(stripe[3]), col = new Float32Array(pp.count * 3);
    for (let i = 0; i < pp.count; i++) { const c = tc.getX(i) >= stripe[0] && tc.getX(i) <= stripe[1] ? b : a; col.set([c.r, c.g, c.b], i * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  g.deleteAttribute('tc');
  return g;
}
function plate(points, thickness, { bevel = 0.0025 } = {}) {
  const sh = new THREE.Shape();
  sh.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) sh.lineTo(points[i][0], points[i][1]);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, {
    depth: Math.max(0.0005, thickness - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 24,
  });
  g.translate(0, 0, -thickness / 2 + bevel);
  return g;
}
function smoothPlate(points, thickness, opts) {
  // points through a closed Catmull-Rom curve for organic outlines
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], 0)), true, 'centripetal');
  const pts = curve.getPoints(points.length * 28).map((v) => [v.x, v.y]);
  return plate(pts, thickness, opts);
}
// Aero-section strut between two points (suspension arm).
const _up = new THREE.Vector3(0, 1, 0);
function strut(a, b, chord = 0.04, thick = 0.012, mat) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = B.clone().sub(A); const len = d.length(); d.normalize();
  let wide = new THREE.Vector3().crossVectors(d, _up);
  if (wide.lengthSq() < 1e-6) wide.set(1, 0, 0);
  wide.normalize();
  const thin = new THREE.Vector3().crossVectors(wide, d).normalize();
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 40, 2);
  const m = new THREE.Mesh(g, mat);
  const basis = new THREE.Matrix4().makeBasis(wide, d, thin);
  m.quaternion.setFromRotationMatrix(basis);
  m.scale.set(chord, len, thick);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  return m;
}

// =====================================================================
// Materials
// =====================================================================
const C = { navy: '#171d36', red: '#d7162a', yellow: '#ffc300', orange: '#f5821f', black: '#0c0d10' };
const paintMats = []; // every livery material reacts to the finish toggle
function paint(opts) {
  const m = new THREE.MeshPhysicalMaterial({
    roughness: 0.48, metalness: 0.0, clearcoat: 0.25, clearcoatRoughness: 0.42,
    normalMap: paintPeel, normalScale: new THREE.Vector2(0.05, 0.05), clearcoatNormalMap: paintPeel, clearcoatNormalScale: new THREE.Vector2(0.05, 0.05),
    ...opts,
  });
  paintMats.push(m);
  return m;
}
// Carbon fibre: 2x2 twill — tow crowns, fibre striations and resin pooling baked into
// colour, normal and anisotropy (the sheen follows each tow, so the weave flips in the light)
const CF = (() => {
  const S = 512, cell = 32, H = new Float32Array(S * S);
  const col = new Uint8ClampedArray(S * S * 4), an = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    const along = (cx + cy) % 4 < 2;
    const lx = ((x % cell) + 0.5) / cell, ly = ((y % cell) + 0.5) / cell;
    const across = along ? ly : lx, len = along ? lx : ly;
    const crown = Math.sin(Math.PI * across);
    const fib = Math.sin(across * Math.PI * 2 * 9 + hash2(cx, cy) * 6.28) * 0.05 + (hash2(x * 7, y * 3) - 0.5) * 0.05;
    const ends = Math.pow(Math.sin(Math.PI * len), 0.25);              // tow dives under at the cell ends
    const hgt = Math.pow(crown, 0.55) * ends * 0.9 + fib;
    H[y * S + x] = hgt;
    const shade = 14 + crown * ends * 20 + (along ? 5 : 0) + fib * 50 + hash2(cx * 3, cy * 5) * 4;
    const k = (y * S + x) * 4;
    col[k] = shade; col[k + 1] = shade + 1; col[k + 2] = shade + 4; col[k + 3] = 255;
    an[k] = along ? 255 : 128; an[k + 1] = along ? 128 : 255; an[k + 2] = 255 * (0.35 + 0.65 * crown); an[k + 3] = 255;
  }
  const mk = (data, srgb, rep) => canvasTex(S, S, (ctx) => { const img = ctx.createImageData(S, S); img.data.set(data); ctx.putImageData(img, 0, 0); }, { srgb, repeat: rep });
  const set = (rep) => ({ map: mk(col, true, rep), normalMap: heightToNormal(H, S, S, 1.8, { repeat: rep }), anisotropyMap: mk(an, false, rep) });
  return { metre: set([12, 12]), unit: set([3, 3]) };
})();
const cfNormal = new THREE.Vector2(0.45, 0.45);
const carbon = new THREE.MeshPhysicalMaterial({ ...CF.metre, normalScale: cfNormal, anisotropy: 0.35, metalness: 0.0, roughness: 0.4, specularIntensity: 0.6, clearcoat: 0.6, clearcoatRoughness: 0.08, envMapIntensity: 0.35 });
const carbonFloor = new THREE.MeshPhysicalMaterial({ ...CF.metre, normalScale: cfNormal, anisotropy: 0.0, metalness: 0.0, roughness: 0.66, specularIntensity: 0.35, clearcoat: 0.1, clearcoatRoughness: 0.45, envMapIntensity: 0.12 });
const carbonUV = new THREE.MeshPhysicalMaterial({ ...CF.unit, normalScale: cfNormal, anisotropy: 0.5, metalness: 0.05, roughness: 0.38, clearcoat: 0.8, clearcoatRoughness: 0.07 });
// Paint micro-texture: faint orange peel under the clear coat
const paintPeel = (() => {
  const S = 512, H = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) H[y * S + x] = fbm(x / 16, y / 16, 3, 32, 32);
  return heightToNormal(H, S, S, 1.6, { repeat: [24, 24] });
})();
const satinBlack = new THREE.MeshPhysicalMaterial({ color: C.black, roughness: 0.55, clearcoat: 0.2, clearcoatRoughness: 0.5 });
const matteBlack = new THREE.MeshStandardMaterial({ color: '#040405', roughness: 0.92, side: THREE.DoubleSide });
const fabric = new THREE.MeshStandardMaterial({ color: '#0d1430', roughness: 0.95 });
const navyPaint = paint({ color: C.navy });
const redPaint = paint({ color: C.red });
const yellowPaint = paint({ color: C.yellow });
const titanium = new THREE.MeshStandardMaterial({ color: '#9a8f86', metalness: 1, roughness: 0.32 });
const darkMetal = new THREE.MeshStandardMaterial({ color: '#17191e', metalness: 0.85, roughness: 0.5 });
const mirrorMat = new THREE.MeshStandardMaterial({ color: '#d8dbe2', metalness: 1, roughness: 0.02 });
const stripePaint = paint({ color: '#ffffff', vertexColors: true });
const rainMat = new THREE.MeshStandardMaterial({ color: '#300', emissive: '#ff1020', emissiveIntensity: 0 });

// =====================================================================
// Car
// =====================================================================
const car = new THREE.Group();
scene.add(car);
const add = (mesh, parent = car) => { mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh; };
const body = (mesh) => { mesh.userData.body = true; return mesh; };
const tag = (mesh, cls) => { mesh.userData.cls = cls; return mesh; };   // engineering material class (Materials view)
   // enclosing bodywork (glass / section cutaways)
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Livery palette (sRGB bytes for the painted textures)
const P = { navy: [23, 29, 54], line: [8, 11, 24], red: [215, 22, 42], org: [246, 128, 30], yel: [255, 195, 0], blk: [10, 10, 12], cf: [22, 23, 27], wht: [236, 238, 242] };
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// Text placeholders for the sponsor positions — edit freely (official logos are not reproduced)
const LIVERY_TEXT = { sidepod: 'RED BULL', rearWing: 'RED BULL RACING', frontWing: 'RACING', endplate: 'RB', halo: 'RB' };

// ---- Fuselage: nose → monocoque → cockpit → airbox → engine cover → crash structure
const D = { dip: 0, dipW: 0.2, zc: 0, uc: 0 };
const FUS = [
  { ...D, x: 2.84, w: 0.030, yB: 0.192, yM: 0.210, yT: 0.230, nT: 2.2, nB: 2.2 },
  { ...D, x: 2.72, w: 0.058, yB: 0.172, yM: 0.205, yT: 0.250, nT: 2.4, nB: 3.0 },
  { ...D, x: 2.45, w: 0.082, yB: 0.166, yM: 0.212, yT: 0.282, nT: 2.5, nB: 3.4 },
  { ...D, x: 2.10, w: 0.110, yB: 0.165, yM: 0.232, yT: 0.330, nT: 2.6, nB: 3.6 },
  { ...D, x: 1.75, w: 0.145, yB: 0.162, yM: 0.262, yT: 0.388, nT: 2.7, nB: 3.8 },
  { ...D, x: 1.40, w: 0.190, yB: 0.148, yM: 0.300, yT: 0.450, nT: 2.8, nB: 4.0 },
  { ...D, x: 1.05, w: 0.240, yB: 0.100, yM: 0.335, yT: 0.520, nT: 2.9, nB: 4.5 },
  { ...D, x: 0.70, w: 0.280, yB: 0.065, yM: 0.360, yT: 0.585, nT: 3.0, nB: 5.0 },
  { ...D, x: 0.45, w: 0.296, yB: 0.058, yM: 0.365, yT: 0.608, nT: 3.2, nB: 5.0, dip: 0.08, dipW: 0.16 },
  { ...D, x: 0.15, w: 0.300, yB: 0.055, yM: 0.368, yT: 0.618, nT: 3.4, nB: 5.0, dip: 0.23, dipW: 0.205 },
  { ...D, x: -0.16, w: 0.298, yB: 0.055, yM: 0.378, yT: 0.636, nT: 3.2, nB: 5.0, dip: 0.23, dipW: 0.205 },
  { ...D, x: -0.28, w: 0.292, yB: 0.055, yM: 0.390, yT: 0.668, nT: 3.0, nB: 5.0 },
  { ...D, x: -0.42, w: 0.280, yB: 0.055, yM: 0.405, yT: 0.840, nT: 2.0, nB: 5.0 },
  { ...D, x: -0.60, w: 0.262, yB: 0.055, yM: 0.410, yT: 0.945, nT: 1.7, nB: 5.0 },
  { ...D, x: -0.85, w: 0.238, yB: 0.055, yM: 0.405, yT: 0.900, nT: 1.65, nB: 5.0 },
  { ...D, x: -1.25, w: 0.195, yB: 0.060, yM: 0.390, yT: 0.760, nT: 1.65, nB: 5.0 },
  { ...D, x: -1.65, w: 0.145, yB: 0.090, yM: 0.370, yT: 0.615, nT: 1.8, nB: 4.0 },
  { ...D, x: -2.00, w: 0.105, yB: 0.140, yM: 0.350, yT: 0.505, nT: 2.0, nB: 3.0 },
  { ...D, x: -2.30, w: 0.074, yB: 0.230, yM: 0.345, yT: 0.440, nT: 2.3, nB: 2.6 },
  { ...D, x: -2.40, w: 0.060, yB: 0.262, yM: 0.343, yT: 0.420, nT: 2.4, nB: 2.4 },
];
const near = (a, b, d) => Math.abs(a - b) < d;
// Flame tongues (abstract charging-bull feel): segments from an origin sweeping back and down, tapering
const FLAMES_ENGINE = [
  [[-0.62, 0.78], [-1.40, 0.68], 0.06], [[-0.62, 0.72], [-1.50, 0.58], 0.055], [[-0.64, 0.67], [-1.30, 0.52], 0.05],
  [[-0.66, 0.62], [-1.12, 0.47], 0.04], [[-0.70, 0.84], [-1.20, 0.79], 0.04], [[-0.6, 0.58], [-0.95, 0.44], 0.03],
];
function flame(x, y, list) {
  let best = 0;
  for (const [[x0, y0], [x1, y1], w0] of list) {
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / L2));
    const d = Math.hypot(x - (x0 + dx * t), y - (y0 + dy * t));
    const w = w0 * Math.pow(1 - t, 0.85) * (1 + 0.25 * Math.sin(t * 19 + x0 * 40));
    if (w > 0 && d < w) best = Math.max(best, 1 - d / w);
  }
  return best;
}
const fusTex = paintLoft(FUS, q(3072), q(1536), (s, th, z, y) => {
  const sn = Math.sin(th), x = s.x;
  if (sn > 0 && s.dip > 0.035 && Math.abs(z) < s.dipW * 0.985) return P.blk;  // cockpit tub
  if (sn < -0.62 && x < 1.9) return P.cf;                                       // carbon underside
  // ---- nose: yellow front with an orange fade and red flame tongues behind it
  const xb = 1.46 + 0.10 * sn + 0.03 * Math.sin(sn * 7);
  if (x > xb) {
    const k = Math.min(1, (x - xb) / 0.22);
    return k < 1 ? mix3(P.org, P.yel, Math.pow(k, 0.6)) : P.yel;
  }
  const tongue = Math.max(0, Math.sin(sn * 10 + 1.1)) ** 1.5;
  if (x > xb - 0.06 - 0.26 * tongue && sn > -0.55) return x > xb - 0.03 - 0.08 * tongue ? P.org : P.red;
  // ---- panel shut lines
  if (near(x, 1.48, 0.003) && sn > -0.5) return P.line;
  if (near(x, -0.66, 0.003) && sn > 0.25 && y < 0.70) return P.line;
  if (x < -0.66 && x > -2.1 && near(y, 0.47, 0.0025) && sn > 0) return P.line;
  // ---- airbox surround: yellow into orange, then flames down the engine cover
  if (x < -0.30 && x > -0.98 && y > 0.66 + (-0.30 - x) * 0.22 && sn > 0) {
    const k = Math.min(1, Math.max(0, (-0.40 - x) / 0.55 + (0.90 - y) * 1.2));
    return k < 0.5 ? P.yel : mix3(P.yel, P.org, (k - 0.5) / 0.5);
  }
  if (sn > -0.2) {
    const f = flame(x, y, FLAMES_ENGINE);
    if (f > 0) return f > 0.72 ? P.org : P.red;
  }
  if (x < -2.22) return P.cf;
  return P.navy;
});
const fusNrm = (() => {
  const W = q(3584), H = q(1792);
  const Hf = bakeLoftHeight(FUS, W, H, (s, th, z, y, arc) => {
    const sn = Math.sin(th), x = s.x;
    let h = (vnoise(x / 0.0016, arc / 0.0016) - 0.5) * 0.025;                     // orange peel (sub-millimetre)
    if (sn > -0.5) { h += groove(x - 1.48); h += fastener(Math.hypot(x - 1.462, modc(arc, 0.05))); }
    if (sn > 0.25) { h += groove(x + 0.66); h += fastener(Math.hypot(x + 0.676, modc(arc, 0.05))); }
    if (x < -0.66 && x > -2.1 && sn > 0) { h += groove(y - 0.47); h += fastener(Math.hypot(y - 0.486, modc(x, 0.06))); }
    if (sn > 0 && s.dip > 0.035 && Math.abs(Math.abs(z) - s.dipW) < 0.02) h += 0.4 * Math.exp(-((Math.abs(z) - s.dipW + 0.008) ** 2) / 0.00004); // cockpit rim lip
    if (x < -2.22 && x > -2.38 && sn > 0) h += fastener(Math.hypot(modc(x, 0.04), modc(arc, 0.04)));      // crash-structure bolts
    return h;
  });
  return heightToNormal(Hf, W, H, 1.5, { wrap: false });
})();
const fusMat = paint({ map: fusTex, normalMap: fusNrm, normalScale: new THREE.Vector2(1, 1), clearcoatNormalMap: fusNrm, clearcoatNormalScale: new THREE.Vector2(1, 1) });
const fus = loft(FUS, { slices: q(780), segs: q(352) });
const fusMesh = body(add(new THREE.Mesh(fus.geo, fusMat)));
body(add(new THREE.Mesh(capGeometry(fus.endRing, new THREE.Vector3(-1, 0, 0)), carbon)));

// ---- Sidepods: letterbox inlet, deep undercut, downwash ramp (mirrored pair)
const POD = [
  { ...D, x: 0.88, w: 0.185, zc: 0.475, yB: 0.355, yM: 0.435, yT: 0.508, nT: 3.4, nB: 3.4, uc: 0.00 },
  { ...D, x: 0.83, w: 0.205, zc: 0.478, yB: 0.300, yM: 0.425, yT: 0.528, nT: 3.6, nB: 3.0, uc: 0.15 },
  { ...D, x: 0.70, w: 0.222, zc: 0.478, yB: 0.190, yM: 0.400, yT: 0.540, nT: 3.6, nB: 2.6, uc: 0.45 },
  { ...D, x: 0.45, w: 0.232, zc: 0.472, yB: 0.080, yM: 0.350, yT: 0.538, nT: 3.4, nB: 2.4, uc: 0.62 },
  { ...D, x: 0.10, w: 0.232, zc: 0.455, yB: 0.052, yM: 0.300, yT: 0.508, nT: 3.0, nB: 2.4, uc: 0.62 },
  { ...D, x: -0.30, w: 0.210, zc: 0.420, yB: 0.050, yM: 0.255, yT: 0.440, nT: 2.8, nB: 2.4, uc: 0.55 },
  { ...D, x: -0.70, w: 0.175, zc: 0.375, yB: 0.050, yM: 0.215, yT: 0.350, nT: 2.6, nB: 2.4, uc: 0.45 },
  { ...D, x: -1.05, w: 0.130, zc: 0.320, yB: 0.050, yM: 0.175, yT: 0.270, nT: 2.4, nB: 2.4, uc: 0.35 },
  { ...D, x: -1.38, w: 0.075, zc: 0.262, yB: 0.050, yM: 0.140, yT: 0.205, nT: 2.2, nB: 2.4, uc: 0.25 },
  { ...D, x: -1.60, w: 0.030, zc: 0.222, yB: 0.058, yM: 0.125, yT: 0.170, nT: 2.2, nB: 2.6, uc: 0.10 },
];
const podTex = paintLoft(POD, 2048, 1024, (s, th) => {
  const sn = Math.sin(th), c = Math.cos(th), x = s.x;
  if (sn < -0.86) return P.cf;
  if ((near(x, 0.30, 0.0035) || near(x, -0.55, 0.0035)) && c > -0.2 && sn > -0.7) return P.line;
  return P.navy;
});
const podNrm = (() => {
  const W = q(2048), H = q(1024);
  const Hf = bakeLoftHeight(POD, W, H, (s, th, z, y, arc) => {
    const sn = Math.sin(th), c = Math.cos(th), x = s.x;
    let h = (vnoise(x / 0.0016, arc / 0.0016) - 0.5) * 0.025;
    if (c > -0.2 && sn > -0.7) for (const x0 of [0.30, -0.55]) { h += groove(x - x0); h += fastener(Math.hypot(x - x0 - 0.016, modc(arc, 0.055))); }
    if (x > 0.80) h += 0.5 * Math.exp(-((x - 0.86) ** 2) / 0.0004);              // rolled inlet lip
    return h;
  });
  return heightToNormal(Hf, W, H, 1.5, { wrap: false });
})();
const podMat = paint({ map: podTex, normalMap: podNrm, normalScale: new THREE.Vector2(1, 1), clearcoatNormalMap: podNrm, clearcoatNormalScale: new THREE.Vector2(1, 1) });
const podMeshes = [];
for (const side of [1, -1]) {
  const L = loft(POD, { slices: q(520), segs: q(300), side });
  podMeshes.push(body(add(new THREE.Mesh(L.geo, podMat))));
  // recessed inlet: a short black tunnel and a back wall, so the mouth has real depth
  const ring = L.startRing, n = ring.length - 1;
  const c = new THREE.Vector3(); for (let j = 0; j < n; j++) c.add(ring[j]); c.divideScalar(n);
  const inner = ring.map((p) => p.clone().sub(c).multiplyScalar(0.84).add(c).add(new THREE.Vector3(-0.07, 0, 0)));
  const pos = [], idx = [];
  ring.forEach((p) => pos.push(p.x, p.y, p.z));
  inner.forEach((p) => pos.push(p.x, p.y, p.z));
  for (let j = 0; j < n; j++) idx.push(j, j + 1, n + 1 + j, j + 1, n + 2 + j, n + 1 + j);
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); tg.setIndex(idx); tg.computeVertexNormals();
  body(add(new THREE.Mesh(tg, matteBlack)));
  body(add(new THREE.Mesh(capGeometry(inner, new THREE.Vector3(1, 0, 0)), matteBlack)));
  body(add(new THREE.Mesh(capGeometry(L.endRing, new THREE.Vector3(-1, 0, 0)), podMat)));
}

// ---- Floor, edge wing, fences, stays, plank
{
  const half = [[1.32, 0.18], [1.24, 0.42], [1.02, 0.60], [0.62, 0.765], [-0.55, 0.785], [-1.12, 0.72], [-1.34, 0.56], [-1.62, 0.52], [-1.76, 0.50]];
  const pts = [...half, ...half.slice().reverse().map(([x, z]) => [x, -z])];
  const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]);
  pts.slice(1).forEach(([x, z]) => sh.lineTo(x, z)); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.003, bevelSegments: 4, curveSegments: 24 });
  g.rotateX(Math.PI / 2); g.translate(0, 0.05, 0);
  add(new THREE.Mesh(g, carbonFloor));
  for (const s of [1, -1]) {
    // floor edge wing, leaning outboard
    const ew = add(new THREE.Mesh(smoothPlate([[0.70, 0.052], [-1.05, 0.052], [-1.12, 0.10], [-0.60, 0.092], [0.20, 0.080], [0.66, 0.066]], 0.006), carbon));
    ew.position.z = s * 0.775; ew.rotation.x = s * 0.45;
    // kick-up in front of the rear tyres
    const k = add(new THREE.Mesh(smoothPlate([[-0.95, 0.04], [-1.30, 0.04], [-1.36, 0.11], [-1.10, 0.075]], 0.006), carbon));
    k.position.z = s * 0.70; k.rotation.y = s * 0.12;
    // venturi inlet fences, curling outboard
    for (let i = 0; i < 4; i++) {
      const f = add(new THREE.Mesh(smoothPlate([[1.28 - i * 0.03, 0.05], [0.72, 0.05], [0.68, 0.17 - i * 0.014], [1.10, 0.155 - i * 0.012]], 0.006), carbon));
      f.position.z = s * (0.20 + i * 0.075);
      f.rotation.y = s * (0.05 + i * 0.035);
    }
    // floor stay (thin titanium rod from chassis to floor edge)
    add(strut([1.02, 0.30, s * 0.24], [0.84, 0.062, s * 0.70], 0.008, 0.008, titanium));
  }
  const plank = tag(new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.01, 0.30), new THREE.MeshStandardMaterial({ color: '#8f7752', roughness: 0.8 })), 'other');
  plank.position.set(-0.1, 0.04, 0); add(plank);
}

// ---- Diffuser
{
  const ramp = [];
  for (let i = 0; i <= 20; i++) { const t = i / 20; ramp.push([-1.70 - t * 0.66, 0.05 + Math.pow(t, 1.6) * 0.25]); }
  const top = ramp.map(([x, y]) => [x, y + 0.008]).reverse();
  add(new THREE.Mesh(plate([...ramp, ...top], 0.96, { bevel: 0 }), carbonFloor));
  for (const z of [-0.47, -0.30, -0.14, 0.14, 0.30, 0.47]) {
    const st = add(new THREE.Mesh(plate([[-1.78, 0.05], [-2.36, 0.05], [-2.36, 0.30], [-2.00, 0.12]], 0.006), carbon));
    st.position.z = z;
  }
}

// ---- Engine cover fin, airbox intake, T-cam, antennas, nose pods, pitot
{
  body(add(new THREE.Mesh(smoothPlate([[-0.72, 0.90], [-1.30, 0.80], [-1.95, 0.70], [-2.05, 0.52], [-1.60, 0.60], [-1.0, 0.80]], 0.008), navyPaint)));
  car.updateMatrixWorld(true);
  const hit = new THREE.Raycaster(new THREE.Vector3(2, 0.86, 0), new THREE.Vector3(-1, 0, 0)).intersectObject(fusMesh)[0];
  const ax = hit ? hit.point.x : -0.45;
  const intake = body(add(new THREE.Mesh(new THREE.CircleGeometry(1, 96), matteBlack)));
  intake.scale.set(0.078, 0.064, 1); intake.rotation.y = Math.PI / 2; intake.position.set(ax + 0.006, 0.858, 0);
  const lip = body(add(new THREE.Mesh(new THREE.TorusGeometry(1, 0.16, 24, 128), yellowPaint)));
  lip.scale.set(0.078, 0.064, 0.085); lip.rotation.y = Math.PI / 2; lip.position.copy(intake.position);
  // T-camera on a slim mast above the roll hoop
  const mast = add(new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.12, 0.012, 3, 0.005), satinBlack));
  mast.position.set(-0.6, 0.995, 0);
  const tcam = add(new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.034, 0.22, 4, 0.012), satinBlack));
  tcam.position.set(-0.6, 1.06, 0);
  for (const s of [1, -1]) {   // lens windows
    const lens = add(new THREE.Mesh(new THREE.CircleGeometry(0.009, 24), mirrorMat));
    lens.rotation.y = Math.PI / 2; lens.position.set(-0.561, 1.06, s * 0.07);
  }
  for (const [x, y, h] of [[1.20, 0.50, 0.07], [-1.45, 0.69, 0.05]]) {
    const a = add(new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.004, h, 8), satinBlack)); a.position.set(x, y + h / 2, 0);
  }
  for (const s of [1, -1]) {
    const pod = add(new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.034, 0.034, 3, 0.014), satinBlack));
    pod.position.set(2.22, 0.305, s * 0.088); pod.rotation.z = -0.12;
  }
  const pitot = add(new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.006, 0.18, 10), titanium));
  pitot.rotation.z = Math.PI / 2; pitot.position.set(2.92, 0.214, 0);
}

// ---- Cockpit: driver, padding, steering wheel
{
  const helmTex = canvasTex(1024, 512, (ctx, w, h) => {
    ctx.fillStyle = '#f4f5f7'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1b2a6b'; ctx.fillRect(0, h * 0.30, w, h * 0.12);
    ctx.fillStyle = '#d1001d'; ctx.fillRect(0, 0, w, h * 0.22);
    ctx.fillStyle = '#ffc400'; ctx.fillRect(0, h * 0.22, w, h * 0.04);
    ctx.fillStyle = '#d1001d'; ctx.fillRect(0, h * 0.42, w, h * 0.03);
    ctx.fillStyle = '#1b2a6b';
    for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc((i + 0.5) * w / 6, h * 0.62, 26, 0, Math.PI * 2); ctx.fill(); }
  });
  const helmMat = new THREE.MeshPhysicalMaterial({ map: helmTex, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 });
  const helmet = new THREE.Group(); helmet.name = 'helmet';
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.125, q(144), q(108)), helmMat);
  shell.scale.set(1.16, 0.97, 0.93);
  helmet.add(shell);
  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.1265, q(144), q(40), Math.PI - 0.95, 1.9, 1.18, 0.46),
    new THREE.MeshPhysicalMaterial({ color: '#0a0a0c', metalness: 0.5, roughness: 0.04, iridescence: 1, iridescenceIOR: 1.9, iridescenceThicknessRange: [250, 900], clearcoat: 1 }),
  );
  visor.scale.copy(shell.scale);
  helmet.add(visor);
  const spoiler = new THREE.Mesh(new RoundedBoxGeometry(0.05, 0.016, 0.16, 2, 0.006), helmMat);
  spoiler.position.set(-0.13, 0.06, 0); spoiler.rotation.z = 0.35; helmet.add(spoiler);
  helmet.position.set(-0.03, 0.635, 0);
  helmet.rotation.z = -0.12;
  helmet.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
  car.add(helmet);
  // shoulders / race suit
  const suit = add(new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshStandardMaterial({ color: '#16245c', roughness: 0.85 }))); suit.name = 'suit';
  suit.scale.set(0.16, 0.07, 0.19); suit.position.set(-0.02, 0.50, 0);
  // headrest padding around the helmet
  for (const s of [1, -1]) {
    const pad = add(new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.09, 0.06, 4, 0.025), fabric));
    pad.position.set(-0.02, 0.575, s * 0.168);
  }
  const back = add(new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.13, 0.28, 4, 0.03), fabric));
  back.position.set(-0.235, 0.60, 0);
  // steering wheel: carbon body, rubber grips, display, rotaries, buttons, shift paddles, LED bar
  const wheel = new THREE.Group(); wheel.name = 'steeringWheel';
  wheel.position.set(0.30, 0.55, 0); wheel.rotation.z = 0.35;
  car.add(wheel);
  const rubber = new THREE.MeshStandardMaterial({ color: '#0b0b0d', roughness: 0.95 });
  add(new THREE.Mesh(new RoundedBoxGeometry(0.032, 0.105, 0.19, 6, 0.012), carbonUV), wheel);
  for (const sd of [1, -1]) {
    const grip = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.019, 0.075, 10, 28), rubber), wheel);
    grip.position.set(0.004, -0.012, sd * 0.118); grip.rotation.x = sd * 0.12;
    const paddle = add(new THREE.Mesh(new RoundedBoxGeometry(0.004, 0.06, 0.05, 2, 0.002), carbonUV), wheel);
    paddle.position.set(0.024, 0.0, sd * 0.07);
  }
  const lcd = add(new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.042), new THREE.MeshStandardMaterial({ color: '#000', emissive: '#2b6cff', emissiveIntensity: 0.7, roughness: 0.15 })), wheel);
  lcd.position.set(-0.0165, 0.012, 0); lcd.rotation.y = -Math.PI / 2;
  const knobMat = new THREE.MeshStandardMaterial({ color: '#c9ccd2', metalness: 1, roughness: 0.3 });
  [[-0.03, -0.055], [-0.03, 0.055], [-0.042, -0.03], [-0.042, 0.03]].forEach(([y, z]) => {
    const k = add(new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.01, 0.012, 24), knobMat), wheel);
    k.rotation.z = Math.PI / 2; k.position.set(-0.02, y, z);
  });
  ['#ff2a3a', '#ffc400', '#2fcf4f', '#2f7bff', '#ffffff', '#ff8a00'].forEach((c, i) => {
    const b = add(new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.006, 20), new THREE.MeshStandardMaterial({ color: c, roughness: 0.4 })), wheel);
    b.rotation.z = Math.PI / 2; b.position.set(-0.018, 0.038 - (i % 3) * 0.014, (i < 3 ? -1 : 1) * 0.062);
  });
  for (let i = 0; i < 15; i++) {
    const led = add(new THREE.Mesh(new THREE.SphereGeometry(0.0032, 12, 8), new THREE.MeshStandardMaterial({ color: '#000', emissive: i < 5 ? '#1aff5a' : i < 10 ? '#ff2a3a' : '#3b8bff', emissiveIntensity: 2.5 })), wheel);
    led.position.set(-0.012, 0.048, (i - 7) * 0.0105);
  }
}

// ---- Halo
{
  const loop = new THREE.CatmullRomCurve3([
    [-0.32, 0.585, -0.250], [-0.20, 0.755, -0.255], [0.05, 0.800, -0.235], [0.30, 0.795, -0.170], [0.455, 0.780, -0.06],
    [0.475, 0.778, 0], [0.455, 0.780, 0.06], [0.30, 0.795, 0.170], [0.05, 0.800, 0.235], [-0.20, 0.755, 0.255], [-0.32, 0.585, 0.250],
  ].map((p) => new THREE.Vector3(...p)), false, 'centripetal');
  tag(add(new THREE.Mesh(new THREE.TubeGeometry(loop, q(720), 0.024, q(48), false), navyPaint)), 'titanium');
  const pillar = new THREE.CatmullRomCurve3([[0.47, 0.785, 0], [0.55, 0.70, 0], [0.64, 0.585, 0]].map((p) => new THREE.Vector3(...p)));
  const pm = tag(add(new THREE.Mesh(new THREE.TubeGeometry(pillar, q(120), 0.028, q(40), false), navyPaint)), 'titanium');
  pm.scale.z = 0.7;
  for (const s of [1, -1]) {   // rear mounting feet
    const foot = tag(add(new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.03, 0.06, 3, 0.012), navyPaint)), 'titanium');
    foot.position.set(-0.31, 0.585, s * 0.25);
  }
}

// ---- Mirrors (on aero supports from the sidepod)
for (const s of [1, -1]) {
  // aero housing: half-ellipsoid nose, flat rear face carrying the glass in a thin bezel
  const housing = add(new THREE.Mesh(new THREE.SphereGeometry(1, q(96), q(48), Math.PI / 2, Math.PI), navyPaint));
  housing.scale.set(0.055, 0.032, 0.088); housing.position.set(0.545, 0.69, s * 0.43);
  const back = add(new THREE.Mesh(new THREE.CircleGeometry(1, q(96)), satinBlack));
  back.scale.set(0.088, 0.032, 1); back.rotation.y = -Math.PI / 2; back.position.set(0.5445, 0.69, s * 0.43);
  const glass = add(new THREE.Mesh(new THREE.CircleGeometry(1, q(96)), mirrorMat));
  glass.scale.set(0.08, 0.026, 1); glass.rotation.y = -Math.PI / 2; glass.position.set(0.5435, 0.69, s * 0.43);
  add(new THREE.Mesh(smoothPlate([[0.62, 0.53], [0.54, 0.53], [0.555, 0.665], [0.615, 0.665]], 0.008), navyPaint)).position.z = s * 0.46;
  add(strut([0.58, 0.68, s * 0.36], [0.60, 0.58, s * 0.27], 0.025, 0.008, navyPaint));
}

// ---- Exhaust & rain light
{
  const heat = canvasTex(256, 16, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#c7c2bd'); g.addColorStop(0.45, '#c9a46a'); g.addColorStop(0.7, '#6f5aa8'); g.addColorStop(1, '#3a4f9a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
  const ex = add(new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.05, 0.24, 48, 1, true),
    new THREE.MeshStandardMaterial({ map: heat, metalness: 1, roughness: 0.3, side: THREE.DoubleSide })));
  ex.rotation.z = Math.PI / 2 - 0.08; ex.position.set(-2.33, 0.47, 0);
  const inner = add(new THREE.Mesh(new THREE.CircleGeometry(0.044, 32), matteBlack));
  inner.rotation.y = -Math.PI / 2; inner.position.set(-2.445, 0.479, 0);
  const rl = add(new THREE.Mesh(new RoundedBoxGeometry(0.02, 0.06, 0.09, 2, 0.006), rainMat));
  rl.position.set(-2.41, 0.33, 0);
}

// ---- Rear wing (endplates, main plane, DRS flap + gurney, beam wing, swan-neck pylon)
const drsPivot = new THREE.Group();
{
  const SPAN = 1.0, HS = SPAN / 2;
  // spoon-shaped centre, tips rolling down into the endplates
  const spoon = (z) => -0.028 * (1 - (z / HS) ** 2) - 0.03 * smooth(0.82, 1, Math.abs(z) / HS);
  add(new THREE.Mesh(wingElement({ chord: 0.33, thick: 0.11, camber: 0.07, aoa: 9, span: SPAN, x: -2.29, y: 0.80, warp: spoon }), navyPaint));
  const flapTE = [-2.735, 1.0225];
  drsPivot.position.set(flapTE[0], flapTE[1], 0);
  car.add(drsPivot);
  const flapGeo = wingElement({ chord: 0.225, thick: 0.09, camber: 0.06, aoa: 38, span: SPAN - 0.01, x: -2.558, y: 0.884, warp: spoon, unitUV: true });
  flapGeo.translate(-flapTE[0], -flapTE[1], 0);
  const flapTex = canvasTex(256, 2048, (ctx, w, h) => {   // u = chord (LE→TE), v = span
    ctx.fillStyle = C.navy; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.translate(w * 0.5, h / 2); ctx.rotate(Math.PI / 2);
    ctx.font = '800 150px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#eef0f4';
    ctx.fillText(LIVERY_TEXT.rearWing, 0, 0, h * 0.9);
    ctx.restore();
  });
  add(new THREE.Mesh(flapGeo, paint({ map: flapTex })), drsPivot);
  const gurney = add(new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.016, SPAN - 0.03), satinBlack), drsPivot);
  gurney.position.set(0.002, 0.006, 0); gurney.rotation.z = -0.66;
  const act = add(new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.05, 0.035, 3, 0.012), navyPaint));
  act.position.set(-2.55, 0.86, 0);
  add(new THREE.Mesh(wingElement({ chord: 0.13, thick: 0.1, camber: 0.05, aoa: 10, span: 0.88, x: -2.38, y: 0.40 }), carbon));
  add(new THREE.Mesh(wingElement({ chord: 0.11, thick: 0.1, camber: 0.05, aoa: 28, span: 0.88, x: -2.50, y: 0.455 }), navyPaint));
  add(new THREE.Mesh(smoothPlate([[-2.24, 0.42], [-2.28, 0.60], [-2.34, 0.79], [-2.46, 0.80], [-2.42, 0.62], [-2.40, 0.42]], 0.028), navyPaint));

  const EX = [-2.86, -2.16], EY = [0.32, 1.10];
  const epTex = canvasTex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = C.navy; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = C.red; ctx.fillRect(w * 0.06, h * 0.36, w * 0.4, h * 0.13);           // rear sponsor box
    ctx.font = '800 italic 54px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f2f4f8';
    ctx.fillText(LIVERY_TEXT.endplate, w * 0.26, h * 0.43);
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = '700 30px system-ui, sans-serif'; ctx.fillText(LIVERY_TEXT.endplate, w * 0.4, h * 0.22);
  });
  const pts = [[-2.25, 0.60], [-2.22, 0.84], [-2.26, 0.96], [-2.40, 1.04], [-2.62, 1.06], [-2.78, 1.02], [-2.82, 0.92], [-2.76, 0.80], [-2.58, 0.72], [-2.46, 0.58], [-2.38, 0.50]];
  for (const s of [1, -1]) {
    const t = epTex.clone(); t.needsUpdate = true;
    const sx = 1 / (EX[1] - EX[0]), sy = 1 / (EY[1] - EY[0]);
    if (s > 0) { t.repeat.set(sx, sy); t.offset.set(-EX[0] * sx, -EY[0] * sy); }
    else { t.repeat.set(-sx, sy); t.offset.set(1 + EX[0] * sx, -EY[0] * sy); }
    const ep = add(new THREE.Mesh(smoothPlate(pts, 0.014), paint({ map: t })));
    ep.position.z = s * (HS + 0.007);
    // endplate rain-light strip
    const strip = add(new THREE.Mesh(new RoundedBoxGeometry(0.012, 0.16, 0.016, 2, 0.004), rainMat));
    strip.position.set(-2.80, 0.86, s * (HS + 0.007)); strip.rotation.z = -0.25;
  }
}

// ---- Front wing (neutral centre, elements curling up into the endplates)
{
  const SPAN = 1.88, HS = SPAN / 2;
  const rise = (k1, k2) => (z) => { const a = Math.abs(z) / HS; return k1 * a * a + k2 * Math.pow(smooth(0.74, 1, a), 1.4); };
  const sweep = (k) => (z) => -k * Math.pow(Math.abs(z) / HS, 2);
  add(new THREE.Mesh(wingElement({ chord: 0.30, thick: 0.08, camber: 0.05, aoa: 3, span: SPAN, x: 2.97, y: 0.072, warp: rise(0.02, 0.03), sweep: sweep(0.04) }), carbon));
  const fwS = (a) => [a, a + 0.07, '#0e1018', C.red];
  add(new THREE.Mesh(wingElement({ chord: 0.22, thick: 0.08, camber: 0.05, aoa: 14, span: SPAN, x: 2.73, y: 0.112, warp: rise(0.04, 0.07), sweep: sweep(0.06), stripe: fwS(0.86) }), stripePaint));
  add(new THREE.Mesh(wingElement({ chord: 0.17, thick: 0.08, camber: 0.05, aoa: 26, span: SPAN, x: 2.57, y: 0.160, warp: rise(0.06, 0.10), sweep: sweep(0.07), stripe: fwS(0.84) }), stripePaint));
  add(new THREE.Mesh(wingElement({ chord: 0.14, thick: 0.08, camber: 0.05, aoa: 38, span: SPAN, x: 2.46, y: 0.208, warp: rise(0.07, 0.12), sweep: sweep(0.07), stripe: fwS(0.80) }), stripePaint));
  for (const s of [1, -1]) {
    const ep = add(new THREE.Mesh(smoothPlate([[2.98, 0.03], [3.0, 0.12], [2.90, 0.25], [2.66, 0.36], [2.42, 0.42], [2.33, 0.36], [2.35, 0.03]], 0.012), navyPaint));
    ep.position.z = s * (HS + 0.006);
    const tip = add(new THREE.Mesh(smoothPlate([[2.90, 0.25], [2.66, 0.365], [2.42, 0.425], [2.33, 0.365], [2.42, 0.38], [2.66, 0.33], [2.86, 0.23]], 0.014), satinBlack));
    tip.position.z = s * (HS + 0.006);
    const fp = add(new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.008, 0.09, 2, 0.003), carbon));
    fp.position.set(2.64, 0.034, s * (HS - 0.04));
    // nose support pylons
    const py = add(new THREE.Mesh(smoothPlate([[2.86, 0.07], [2.62, 0.10], [2.64, 0.20], [2.80, 0.20]], 0.01), navyPaint));
    py.position.z = s * 0.05;
  }
}

// ---- Wheels (tyre with raised sidewall lettering, rim, wheel cover, brake duct)
const TYRES = [
  { id: 'soft', name: '소프트', c: '#ff2a2a', label: 'SOFT' },
  { id: 'medium', name: '미디엄', c: '#ffd21f', label: 'MEDIUM' },
  { id: 'hard', name: '하드', c: '#f4f4f4', label: 'HARD' },
  { id: 'inter', name: '인터', c: '#2fcf4f', label: 'INTERMEDIATE' },
  { id: 'wet', name: '웻', c: '#2f7bff', label: 'WET' },
];
const R = 0.36, RIM = 0.229;
const PHI0 = Math.PI * 7 / 6, PHI1 = -Math.PI / 6, NPROF = q(240);
function tyreProfile(width) {
  const rc = (RIM + R) / 2, hr = (R - RIM) / 2, hw = width / 2 + 0.006, n = 5;
  const pts = [new THREE.Vector2(RIM - 0.002, -width / 2 + 0.018)];
  for (let i = 0; i <= NPROF; i++) {
    const phi = PHI0 + (PHI1 - PHI0) * (i / NPROF);
    const c = Math.cos(phi), s = Math.sin(phi);
    const a = hw * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    const r = rc + hr * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
    pts.push(new THREE.Vector2(Math.max(r, RIM), a));
  }
  pts.push(new THREE.Vector2(RIM - 0.002, width / 2 - 0.018));
  return pts;
}
const vOfPhi = (phi) => (1 + ((PHI0 - phi) / (PHI0 - PHI1)) * NPROF) / (NPROF + 2);
// mode: 'color' | 'height' | 'rough' — the same layout drives all three maps so they line up
function drawTyre(ctx, w, h, t, mode) {
  const C = mode === 'color', Hm = mode === 'height';
  const pick = (c, hv, r) => (C ? c : Hm ? hv : r);
  const yOf = (phi) => (1 - vOfPhi(phi)) * h;
  const rand = rng(1234);
  ctx.fillStyle = pick('#16171a', '#808080', '#d6d6d6'); ctx.fillRect(0, 0, w, h);
  // sidewalls are moulded smoother than the scrubbed tread
  ctx.fillStyle = pick('#17181b', '#808080', '#b4b4b4');
  ctx.fillRect(0, yOf(-0.55), w, yOf(1.12) - yOf(-0.55));
  ctx.fillRect(0, yOf(2.02), w, h - yOf(2.02));
  // tread: graining streaks, rubber pick-up (marbles) and blistering
  const t0 = yOf(1.95), t1 = yOf(1.18);
  for (let i = 0; i < 16000; i++) {
    const y = t1 + rand() * (t0 - t1), lite = rand() < 0.5;
    ctx.fillStyle = pick(`rgba(255,255,255,${rand() * 0.035})`, lite ? 'rgba(150,150,150,.3)' : 'rgba(105,105,105,.3)', lite ? 'rgba(235,235,235,.18)' : 'rgba(175,175,175,.18)');
    ctx.fillRect(rand() * w, y, 2 + rand() * 36, 1 + rand() * 1.6);
  }
  for (let i = 0; i < 900; i++) {
    const y = t1 + rand() * (t0 - t1), r = 1.5 + rand() * 3.5, x = rand() * w;
    ctx.fillStyle = pick('#0e0e10', '#c4c4c4', '#f0f0f0');
    ctx.beginPath(); ctx.ellipse(x, y, r * 1.6, r, 0, 0, Math.PI * 2); ctx.fill();
  }
  // compound bands (raised) with moulded grooves either side
  ctx.fillStyle = pick(t.c, '#b6b6b6', '#9a9a9a');
  ctx.fillRect(0, yOf(-0.30) - 5, w, 10);
  ctx.fillRect(0, yOf(0.36) - 3, w, 6);
  if (!C) { ctx.fillStyle = pick('', '#555', '#c8c8c8'); for (const p of [-0.42, -0.18, 0.28, 0.46]) ctx.fillRect(0, yOf(p) - 1, w, 2); }
  // rim-protector ridge near the bead
  if (Hm) { ctx.fillStyle = '#c0c0c0'; ctx.fillRect(0, yOf(-0.48) - 3, w, 6); }
  // raised lettering + small moulded text
  ctx.save();
  ctx.translate(0, yOf(0.03));
  ctx.scale(1, -1);
  ctx.textBaseline = 'middle';
  for (let k = 0; k < 2; k++) {
    const x0 = k * w / 2;
    ctx.font = '900 italic 46px system-ui, sans-serif';
    ctx.fillStyle = pick('#f2f2f2', '#e0e0e0', '#8c8c8c'); ctx.fillText('FORMULA SLICK', x0 + 120, 0);
    ctx.fillStyle = pick(t.c, '#e0e0e0', '#8c8c8c'); ctx.fillText(t.label, x0 + 620, 0);
    ctx.fillStyle = pick('#f2f2f2', '#e0e0e0', '#8c8c8c'); ctx.fillText('18"', x0 + 1300, 0);
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillStyle = pick('#3a3b40', '#c4c4c4', '#a8a8a8'); ctx.fillText('305/670 R18  ·  TUBELESS  ·  DIRECTION ▶  ·  MADE FOR RACING USE ONLY', x0 + 1480, 0);
  }
  ctx.restore();
}
const tyreTexCache = {};
function tyreTexture(t) {
  if (tyreTexCache[t.id]) return tyreTexCache[t.id];
  const W = q(4096), Hh = q(512);
  const map = canvasTex(W, Hh, (ctx, w, h) => drawTyre(ctx, w, h, t, 'color'));
  const rough = canvasTex(W, Hh, (ctx, w, h) => drawTyre(ctx, w, h, t, 'rough'), { srgb: false });
  const hc = document.createElement('canvas'); hc.width = W; hc.height = Hh;
  drawTyre(hc.getContext('2d'), W, Hh, t, 'height');
  const normal = heightToNormal(canvasHeight(hc), W, Hh, 1.3, { repeat: [-1, 1] });
  // clockwise lettering, tops facing out
  for (const tex of [map, rough]) { tex.wrapS = THREE.RepeatWrapping; tex.repeat.x = -1; }
  return (tyreTexCache[t.id] = { map, rough, normal });
}
const tyreMat = new THREE.MeshPhysicalMaterial({ roughness: 1, metalness: 0, normalScale: new THREE.Vector2(1, 1), sheen: 0.25, sheenRoughness: 0.8, sheenColor: '#222' });
const nutPaint = paint({ color: '#cfdc00' });
// forged magnesium rim (black-painted) with a machined bead lip
const magRim = new THREE.MeshStandardMaterial({ color: '#232428', metalness: 0.75, roughness: 0.42, side: THREE.DoubleSide });
const magLip = new THREE.MeshStandardMaterial({ color: '#9a9ca2', metalness: 1, roughness: 0.28 });
// carbon-carbon brake disc: faces with a felted fibre look, edge with rows of ventilation holes
const ccFace = canvasTex(512, 512, (ctx, w, h) => {
  ctx.fillStyle = '#2e2e30'; ctx.fillRect(0, 0, w, h);
  const r = rng(5);
  for (let i = 0; i < 14000; i++) { const a = rand2(); ctx.fillStyle = `rgba(${a > .5 ? 255 : 0},${a > .5 ? 255 : 0},${a > .5 ? 255 : 0},${0.03 + r() * 0.05})`; ctx.fillRect(r() * w, r() * h, 1 + r() * 6, 1); }
  function rand2() { return r(); }
});
const ccEdge = canvasTex(1024, 64, (ctx, w, h) => {
  ctx.fillStyle = '#323234'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#060607';
  for (let row = 0; row < 4; row++) for (let i = 0; i < 128; i++) { ctx.beginPath(); ctx.arc((i + (row % 2) * 0.5) * (w / 128), 9 + row * 15, 2.6, 0, Math.PI * 2); ctx.fill(); }
}, { repeat: [1, 1] });
ccEdge.wrapS = THREE.RepeatWrapping;
const ccFaceMat = new THREE.MeshStandardMaterial({ map: ccFace, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide });
const ccEdgeMat = new THREE.MeshStandardMaterial({ map: ccEdge, roughness: 0.8, metalness: 0.05, emissive: '#ff4a10', emissiveIntensity: 0 });
const caliperMat = new THREE.MeshStandardMaterial({ color: '#3a3d44', metalness: 0.8, roughness: 0.38 });
function brake(front) {
  const g = new THREE.Group(), ro = front ? 0.139 : 0.133, ri = 0.088, t = 0.032;
  const edge = tag(new THREE.Mesh(new THREE.CylinderGeometry(ro, ro, t, q(160), 1, true), ccEdgeMat), 'cc');
  edge.rotation.x = Math.PI / 2; g.add(edge);
  for (const zz of [t / 2, -t / 2]) { const f = tag(new THREE.Mesh(new THREE.RingGeometry(ri, ro, q(160), 1), ccFaceMat), 'cc'); f.position.z = zz; g.add(f); }
  const bell = tag(new THREE.Mesh(new THREE.CylinderGeometry(ri, ri * 0.8, 0.05, 48, 1, true), magLip), 'titanium'); bell.rotation.x = Math.PI / 2; bell.position.z = 0.03; g.add(bell);
  const cal = tag(new THREE.Mesh(new THREE.TorusGeometry(ro - 0.01, 0.024, 16, 48, 1.05), caliperMat), 'aluminium');
  cal.scale.z = 1.9; cal.rotation.z = front ? 1.9 : 0.25; g.add(cal);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
const coverMat = new THREE.MeshPhysicalMaterial({ ...CF.unit, color: '#5a5a5a', normalScale: new THREE.Vector2(0.35, 0.35), anisotropy: 0.4, roughness: 0.4, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.08, envMapIntensity: 0.45 });
function makeWheel(width, front) {
  const g = new THREE.Group();
  const tg = new THREE.LatheGeometry(tyreProfile(width), q(420));
  tg.rotateX(Math.PI / 2);
  const tyre = new THREE.Mesh(tg, tyreMat); tyre.castShadow = tyre.receiveShadow = true; g.add(tyre);
  const barrel = tag(new THREE.Mesh(new THREE.CylinderGeometry(RIM, RIM, width - 0.03, q(160), 1, true), magRim), 'magnesium');
  barrel.rotation.x = Math.PI / 2; g.add(barrel);
  const disc = brake(front); disc.position.z = -width / 2 + 0.055; g.add(disc);
  // outer wheel cover: shallow carbon dish
  const dish = [];
  for (let i = 0; i <= 28; i++) { const r = (i / 28) * RIM; dish.push(new THREE.Vector2(r, -0.016 * (1 - (r / RIM) ** 2))); }
  const cg = new THREE.LatheGeometry(dish, q(240)); cg.rotateX(-Math.PI / 2);
  { const pp = cg.attributes.position, uv = cg.attributes.uv; for (let i = 0; i < pp.count; i++) uv.setXY(i, pp.getX(i) / (2 * RIM) + 0.5, pp.getY(i) / (2 * RIM) + 0.5); }
  const cover = new THREE.Mesh(cg, coverMat); cover.position.z = width / 2 - 0.02; cover.receiveShadow = true; g.add(cover);
  const lipRing = tag(new THREE.Mesh(new THREE.TorusGeometry(RIM - 0.006, 0.007, 16, q(240)), magLip), 'magnesium'); lipRing.position.z = width / 2 - 0.02; g.add(lipRing);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.004, 8, 64), yellowPaint); ring2.position.z = width / 2 - 0.03; g.add(ring2);
  const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.044, 0.05, 12), nutPaint);
  nut.rotation.x = Math.PI / 2; nut.position.z = width / 2 - 0.02; nut.castShadow = true; g.add(nut);
  const pin = tag(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 16), titanium), 'titanium');
  pin.rotation.x = Math.PI / 2; pin.position.z = width / 2 + 0.01; g.add(pin);
  // inner side: brake duct drum with cooling slots
  const drum = body(new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.215, 0.13, 64), carbonUV));
  drum.rotation.x = Math.PI / 2; drum.position.z = -width / 2 - 0.02; drum.castShadow = true; g.add(drum);
  const inner = tag(new THREE.Mesh(new THREE.RingGeometry(0.15, RIM, 72), magRim), 'magnesium'); inner.position.z = -width / 2 + 0.02; inner.rotation.y = Math.PI; g.add(inner);
  if (front) {
    const wl = new THREE.Mesh(new THREE.TorusGeometry(R + 0.035, 0.008, 8, 64, 1.1), carbon);
    wl.rotation.z = Math.PI / 2 - 0.2; wl.scale.set(1, 1, 3); wl.position.z = -width / 2 - 0.03; wl.castShadow = true; g.add(wl);
  }
  return g;
}
const WHEELS = [
  { x: 1.80, z: 0.80, w: 0.305, front: true },
  { x: -1.80, z: 0.765, w: 0.405, front: false },
];
const wheelGroups = [];
for (const W of WHEELS) for (const s of [1, -1]) {
  const wg = makeWheel(W.w, W.front);
  wg.position.set(W.x, R - 0.006, s * W.z);
  if (s < 0) wg.rotation.y = Math.PI;
  car.add(wg);
  wheelGroups.push({ g: wg, front: W.front, side: s });
}

// ---- Suspension
{
  const m = carbon, ends = [];
  const strutT = strut;
  const strut2 = (a, b, c, t, mat) => { ends.push(a, b); return strutT(a, b, c, t, mat); };
  const f = (s) => [
    strut2([1.56, 0.42, s * 0.15], [1.80, 0.50, s * 0.68], 0.05, 0.014, m),
    strut2([2.06, 0.40, s * 0.11], [1.80, 0.50, s * 0.68], 0.05, 0.014, m),
    strut2([1.50, 0.22, s * 0.16], [1.82, 0.20, s * 0.70], 0.05, 0.014, m),
    strut2([2.06, 0.21, s * 0.11], [1.82, 0.20, s * 0.70], 0.05, 0.014, m),
    strut2([1.82, 0.22, s * 0.66], [1.66, 0.43, s * 0.15], 0.035, 0.014, m),
    strut2([1.97, 0.38, s * 0.12], [1.95, 0.45, s * 0.67], 0.03, 0.012, m),
  ];
  const r = (s) => [
    strut2([-1.58, 0.44, s * 0.17], [-1.80, 0.52, s * 0.60], 0.05, 0.014, m),
    strut2([-2.02, 0.44, s * 0.11], [-1.80, 0.52, s * 0.60], 0.05, 0.014, m),
    strut2([-1.55, 0.18, s * 0.25], [-1.80, 0.18, s * 0.62], 0.05, 0.014, m),
    strut2([-2.05, 0.20, s * 0.12], [-1.80, 0.18, s * 0.62], 0.05, 0.014, m),
    strut2([-1.84, 0.50, s * 0.58], [-1.70, 0.22, s * 0.16], 0.035, 0.014, m),
    strut2([-1.80, 0.36, s * 0.08], [-1.80, 0.36, s * 0.58], 0.05, 0.05, darkMetal),
  ];
  for (const s of [1, -1]) [...f(s), ...r(s)].forEach((o) => add(o));
  // titanium spherical joints at every pick-up point, titanium uprights carrying the hubs
  const joint = new THREE.SphereGeometry(0.013, 20, 14);
  for (const e of ends) { const j = tag(add(new THREE.Mesh(joint, titanium)), 'titanium'); j.position.set(...e); }
  for (const [x, z] of [[1.80, 0.62], [-1.80, 0.56]]) for (const s of [1, -1]) {
    const up = tag(add(new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.36, 0.05, 4, 0.016), titanium)), 'titanium');
    up.position.set(x, 0.35, s * z);
  }
}

// ---- Decals projected onto the curved bodywork
function decalTex(w, h, draw) { return canvasTex(w, h, (ctx) => { ctx.clearRect(0, 0, w, h); draw(ctx, w, h); }); }
const wordmarkTex = decalTex(1024, 256, (ctx, w, h) => {
  ctx.font = '700 188px "Helvetica Neue", Arial, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f2f4f8'; ctx.fillText(LIVERY_TEXT.sidepod, w / 2, h / 2 + 8, w * 0.96);
});
const smallMarkTex = decalTex(512, 128, (ctx, w, h) => {
  ctx.font = '800 italic 84px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f2f4f8'; ctx.fillText(LIVERY_TEXT.frontWing, w / 2, h / 2 + 4, w * 0.94);
});
const racingTex = decalTex(1024, 256, (ctx) => {
  const g = ctx.createRadialGradient(110, 118, 8, 128, 128, 92);
  g.addColorStop(0, '#ffe680'); g.addColorStop(1, '#ffbf00');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(128, 128, 88, 0, Math.PI * 2); ctx.fill();
  ctx.font = '900 italic 120px system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f2f4f8';
  ctx.fillText('RACING', 250, 136);
});
const numberTex = decalTex(256, 256, (ctx) => {
  ctx.font = '900 italic 230px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 14; ctx.strokeStyle = '#d1001d'; ctx.strokeText('1', 128, 136);
  ctx.fillStyle = '#ffffff'; ctx.fillText('1', 128, 136);
});
const louvreTex = decalTex(512, 256, (ctx, w, h) => {
  // cooling louvres: dark slots with a lit upper lip
  for (let i = 0; i < 8; i++) {
    const x = 24 + i * 60;
    const g = ctx.createLinearGradient(x, 0, x + 36, 0);
    g.addColorStop(0, '#000'); g.addColorStop(0.7, '#05060a'); g.addColorStop(1, '#2a3566');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(x, 20 + i * 4, 36, h - 40 - i * 8, 10); ctx.fill();
  }
});
function decalAt(target, tex, origin, dir, rightHint, size, depth = 0.3) {
  car.updateMatrixWorld(true);
  const d = new THREE.Vector3(...dir).normalize();
  const hit = new THREE.Raycaster(new THREE.Vector3(...origin), d).intersectObject(target)[0];
  if (!hit) return;
  const n = hit.face.normal.clone().transformDirection(target.matrixWorld);
  if (n.dot(d) > 0) n.negate();
  const hint = new THREE.Vector3(...rightHint);
  const right = hint.sub(n.clone().multiplyScalar(hint.dot(n))).normalize();
  const up = new THREE.Vector3().crossVectors(n, right);
  const e = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, n));
  const mat = paint({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  const m = new THREE.Mesh(new DecalGeometry(target, hit.point, e, new THREE.Vector3(size[0], size[1], depth)), mat);
  m.receiveShadow = true;
  car.add(m);
}
for (const s of [1, -1]) {
  const pod = podMeshes[s > 0 ? 0 : 1];
  decalAt(pod, wordmarkTex, [0.14, 0.40, s * 3], [0, 0, -s], [s, 0, 0], [0.86, 0.215]);
  decalAt(pod, louvreTex, [-0.62, 2, s * 0.40], [0, -1, 0], [1, 0, 0], [0.34, 0.15], 0.12);
  decalAt(fusMesh, louvreTex, [-1.45, 2, s * 0.13], [0, -1, 0], [1, 0, 0], [0.26, 0.11], 0.1);
  decalAt(fusMesh, numberTex, [1.62, 0.33, s * 3], [0, 0, -s], [s, 0, 0], [0.12, 0.12]);
}
decalAt(fusMesh, numberTex, [1.58, 2, 0], [0, -1, 0], [0, 0, -1], [0.10, 0.10], 0.12);


return { canvasTex, DETAIL, q, hash2, vnoise, fbm, rng, heightToNormal, canvasHeight, catmull, sampleStations, sectionPoint, loft, capGeometry, paintLoft, bakeLoftHeight, groove, fastener, modc, aerofoilShape, wingElement, plate, smoothPlate, _up, strut, C, paintMats, paint, CF, cfNormal, carbon, carbonFloor, carbonUV, paintPeel, satinBlack, matteBlack, fabric, navyPaint, redPaint, yellowPaint, titanium, darkMetal, mirrorMat, stripePaint, rainMat, car, add, body, tag, smooth, P, mix3, LIVERY_TEXT, D, FUS, near, FLAMES_ENGINE, flame, fusTex, fusNrm, fusMat, fus, fusMesh, POD, podTex, podNrm, podMat, podMeshes, drsPivot, TYRES, R, PHI0, tyreProfile, vOfPhi, drawTyre, tyreTexCache, tyreTexture, tyreMat, nutPaint, magRim, magLip, ccFace, ccEdge, ccFaceMat, ccEdgeMat, caliperMat, brake, coverMat, makeWheel, WHEELS, decalTex, wordmarkTex, smallMarkTex, racingTex, numberTex, louvreTex, decalAt, wheelGroups };
};
