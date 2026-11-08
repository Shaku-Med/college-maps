// The route drawn on the ground through the camera: the phone's pose comes from gravity and the compass, never from AR tracking.

export type Vec3 = { x: number; y: number; z: number };

export type FloorShapes = {
  ribbon: string;
  chevrons: string;
  finish: string;
  /** Which way to move the phone when none of the way ahead is on screen. */
  look: 'left' | 'right' | 'down' | 'up' | null;
  /** False until the phone knows which way it faces. */
  ready: boolean;
};

/** About how high a phone is held when walking with it out. */
const EYE_HEIGHT = 1.4;
// Ground right under the lens would blow up across the screen, so drawing starts this far ahead.
const NEAR = 0.8;
const HALF_WIDTH = 0.45;
const CHEVRON_EVERY = 2;
const CHEVRON_REACH = 30;
const LOOK_AHEAD = 6;
// What the main camera sees along its long side, which runs top to bottom in portrait.
const VERTICAL_FOV = (66 * Math.PI) / 180;
// A chevron lying flat, in meters ahead and to the right of its own spot on the route.
const CHEVRON = [0.32, 0, -0.08, 0.38, -0.34, 0.38, 0.06, 0, -0.34, -0.38, -0.08, -0.38];
const FINISH_RADIUS = 0.8;
const FINISH_SIDES = 20;

const EMPTY: FloorShapes = { ribbon: '', chevrons: '', finish: '', look: null, ready: false };

function focalLength(height: number) {
  'worklet';
  return height / 2 / Math.tan(VERTICAL_FOV / 2);
}

/**
 * East, north and up as seen by the phone, nine numbers in its own axes (x right, y to the top, z out of the screen).
 * `down` is gravity, `field` the calibrated compass, and `declination` how far magnetic north sits east of true north.
 */
export function cameraAxes(down: Vec3, field: Vec3, declination: number): number[] | null {
  'worklet';
  const g = Math.hypot(down.x, down.y, down.z);
  if (g < 3 || Math.hypot(field.x, field.y, field.z) < 5) return null;
  const ux = -down.x / g;
  const uy = -down.y / g;
  const uz = -down.z / g;
  let ex = field.y * uz - field.z * uy;
  let ey = field.z * ux - field.x * uz;
  let ez = field.x * uy - field.y * ux;
  const e = Math.hypot(ex, ey, ez);
  if (e < 1) return null;
  ex /= e;
  ey /= e;
  ez /= e;
  const nx = uy * ez - uz * ey;
  const ny = uz * ex - ux * ez;
  const nz = ux * ey - uy * ex;
  const c = Math.cos(declination);
  const s = Math.sin(declination);
  return [
    s * nx + c * ex,
    s * ny + c * ey,
    s * nz + c * ez,
    c * nx - s * ex,
    c * ny - s * ey,
    c * nz - s * ez,
    ux,
    uy,
    uz,
  ];
}

/**
 * The ribbon, chevrons and finish ring for the route ahead, as SVG paths in screen points.
 * `path` holds east and north pairs in meters from a fixed anchor, starting `startAlong` meters into the route.
 */
export function floorShapes(
  axes: number[] | null,
  path: number[],
  startAlong: number,
  camAlong: number,
  camE: number,
  camN: number,
  width: number,
  height: number,
  finish: boolean,
): FloorShapes {
  'worklet';
  if (!axes) return EMPTY;
  const pitch = Math.asin(Math.max(-1, Math.min(1, -axes[8])));
  const f = focalLength(height);
  const cx = width / 2;
  const cy = height / 2;
  const depth = (e: number, n: number) => -(e * axes[2] + n * axes[5] - EYE_HEIGHT * axes[8]);
  const project = (e: number, n: number) => {
    const d = depth(e, n);
    const x = e * axes[0] + n * axes[3] - EYE_HEIGHT * axes[6];
    const y = e * axes[1] + n * axes[4] - EYE_HEIGHT * axes[7];
    return [cx + (f * x) / d, cy - (f * y) / d];
  };
  const screen = (e: number, n: number) => {
    const [x, y] = project(e, n);
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  };

  // The route relative to the camera, with repeated points dropped so every segment has a direction.
  const es: number[] = [];
  const ns: number[] = [];
  const at: number[] = [];
  let along = startAlong;
  for (let i = 0; i + 1 < path.length; i += 2) {
    const e = path[i] - camE;
    const n = path[i + 1] - camN;
    const last = es.length - 1;
    if (last >= 0) {
      const step = Math.hypot(e - es[last], n - ns[last]);
      if (step < 0.05) continue;
      along += step;
    }
    es.push(e);
    ns.push(n);
    at.push(along);
  }
  if (es.length < 2) return { ...EMPTY, ready: true };

  // Mitred edges, then the outline cut where it comes closer than NEAR.
  const right: number[] = [];
  const left: number[] = [];
  for (let i = 0; i < es.length; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(es.length - 1, i + 1);
    const inLen = Math.hypot(es[i] - es[a], ns[i] - ns[a]) || 1;
    const outLen = Math.hypot(es[b] - es[i], ns[b] - ns[i]) || 1;
    const inE = i > 0 ? (es[i] - es[a]) / inLen : (es[b] - es[i]) / outLen;
    const inN = i > 0 ? (ns[i] - ns[a]) / inLen : (ns[b] - ns[i]) / outLen;
    const outE = i < es.length - 1 ? (es[b] - es[i]) / outLen : inE;
    const outN = i < es.length - 1 ? (ns[b] - ns[i]) / outLen : inN;
    let me = inN + outN;
    let mn = -inE - outE;
    const m = Math.hypot(me, mn) || 1;
    me /= m;
    mn /= m;
    const reach = HALF_WIDTH / Math.max(0.5, me * outN - mn * outE);
    right.push(es[i] + me * reach, ns[i] + mn * reach);
    left.push(es[i] - me * reach, ns[i] - mn * reach);
  }
  const ring: number[] = [...right];
  for (let i = left.length - 2; i >= 0; i -= 2) ring.push(left[i], left[i + 1]);
  let ribbon = '';
  const count = ring.length / 2;
  for (let i = 0; i < count; i++) {
    const e1 = ring[i * 2];
    const n1 = ring[i * 2 + 1];
    const j = (i + 1) % count;
    const e2 = ring[j * 2];
    const n2 = ring[j * 2 + 1];
    const d1 = depth(e1, n1);
    const d2 = depth(e2, n2);
    if (d1 >= NEAR) ribbon += `${ribbon ? 'L' : 'M'}${screen(e1, n1)}`;
    if (d1 >= NEAR !== d2 >= NEAR) {
      const t = (NEAR - d1) / (d2 - d1);
      ribbon += `${ribbon ? 'L' : 'M'}${screen(e1 + (e2 - e1) * t, n1 + (n2 - n1) * t)}`;
    }
  }
  if (ribbon) ribbon += 'Z';

  // Chevrons sit at fixed distances along the route, so they stay put on the ground as you walk past them, and only ahead of you.
  let chevrons = '';
  let segment = 1;
  const firstChevron = Math.ceil(Math.max(at[0], camAlong) / CHEVRON_EVERY) * CHEVRON_EVERY;
  for (let s = firstChevron; s <= at[at.length - 1]; s += CHEVRON_EVERY) {
    while (segment < at.length - 1 && at[segment] < s) segment++;
    const span = at[segment] - at[segment - 1] || 1;
    const t = (s - at[segment - 1]) / span;
    const de = (es[segment] - es[segment - 1]) / span;
    const dn = (ns[segment] - ns[segment - 1]) / span;
    const pe = es[segment - 1] + (es[segment] - es[segment - 1]) * t;
    const pn = ns[segment - 1] + (ns[segment] - ns[segment - 1]) * t;
    if (Math.hypot(pe, pn) > CHEVRON_REACH) break;
    let shape = '';
    for (let k = 0; k < CHEVRON.length; k += 2) {
      const e = pe + de * CHEVRON[k] + dn * CHEVRON[k + 1];
      const n = pn + dn * CHEVRON[k] - de * CHEVRON[k + 1];
      if (depth(e, n) < NEAR) {
        shape = '';
        break;
      }
      shape += `${k === 0 ? 'M' : 'L'}${screen(e, n)}`;
    }
    if (shape) chevrons += `${shape}Z`;
  }

  let finishRing = '';
  if (finish) {
    const fe = es[es.length - 1];
    const fn = ns[ns.length - 1];
    for (let k = 0; k < FINISH_SIDES; k++) {
      const angle = (k / FINISH_SIDES) * Math.PI * 2;
      const e = fe + Math.cos(angle) * FINISH_RADIUS;
      const n = fn + Math.sin(angle) * FINISH_RADIUS;
      if (depth(e, n) < NEAR) {
        finishRing = '';
        break;
      }
      finishRing += `${k === 0 ? 'M' : 'L'}${screen(e, n)}`;
    }
    if (finishRing) finishRing += 'Z';
  }

  const pointAt = (s: number) => {
    let k = 1;
    while (k < at.length - 1 && at[k] < s) k++;
    const share = (s - at[k - 1]) / (at[k] - at[k - 1] || 1);
    return [es[k - 1] + (es[k] - es[k - 1]) * share, ns[k - 1] + (ns[k] - ns[k - 1]) * share];
  };

  // A hint only helps when none of the way ahead is on screen; with some in view it would argue with the arrows.
  let inView = false;
  const end = Math.min(at[at.length - 1], camAlong + CHEVRON_REACH);
  for (let s = Math.max(at[0], camAlong); s <= end && !inView; s += 1) {
    const [e, n] = pointAt(s);
    if (depth(e, n) < NEAR) continue;
    const [x, y] = project(e, n);
    inView = x >= 0 && x <= width && y >= 0 && y <= height;
  }
  if (inView) return { ribbon, chevrons, finish: finishRing, look: null, ready: true };

  // Which way the route goes a few steps on, against where the camera looks, or the top of a phone held flat.
  const [te, tn] = pointAt(Math.min(at[at.length - 1], camAlong + LOOK_AHEAD));
  let fe = -axes[2];
  let fn = -axes[5];
  if (Math.hypot(fe, fn) < 0.3) {
    fe = axes[1];
    fn = axes[4];
  }
  const turn = Math.atan2(fn * te - fe * tn, fe * te + fn * tn);
  const half = Math.atan(width / 2 / f);
  const look =
    turn < -half ? 'left' : turn > half ? 'right' : pitch > -Math.atan(EYE_HEIGHT / LOOK_AHEAD) ? 'down' : 'up';
  return { ribbon, chevrons, finish: finishRing, look, ready: true };
}
