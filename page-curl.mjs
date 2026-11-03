// Independent paper-fold geometry. Coordinates and UVs originate in the flat leaf.
const PI = Math.PI;

function finite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number.`);
  }
  return value;
}

function unit(value, name) {
  return Math.max(0, Math.min(1, finite(value, name)));
}

function optionsFor(options) {
  const { direction = 1, corner = 'bottom', vertical = 0, aspect = 1, mode = 'double', radius = .07 } = options;
  const gripY = options.gripY === undefined ? undefined : unit(options.gripY, 'gripY');
  finite(direction, 'direction');
  finite(vertical, 'vertical');
  finite(aspect, 'aspect');
  finite(radius, 'radius');
  if (direction !== 1 && direction !== -1) throw new RangeError('direction must be 1 or -1.');
  if (corner !== 'top' && corner !== 'bottom') throw new TypeError('corner must be top or bottom.');
  if (mode !== 'double' && mode !== 'single') throw new TypeError('mode must be double or single.');
  if (aspect <= 0) throw new RangeError('aspect must be greater than zero.');
  if (radius <= 0) throw new RangeError('radius must be greater than zero.');
  return { direction, corner, gripY, vertical, aspect, mode, maxRadius: radius };
}

/** Exact Euclidean projection onto the intersection of the two spine disks. */
function projectTarget(point, aspect, cornerY) {
  const circles = [
    { x: 0, y: 0, radius: Math.hypot(1, cornerY) },
    { x: 0, y: aspect, radius: Math.hypot(1, cornerY - aspect) },
  ];
  const tolerance = 1e-12 * Math.max(1, aspect);
  const inside = (candidate) => Number.isFinite(candidate.x) && Number.isFinite(candidate.y)
    && circles.every((circle) => Math.hypot(candidate.x - circle.x, candidate.y - circle.y) <= circle.radius + tolerance);
  if (inside(point)) return { ...point };
  // Both circle boundaries meet at the original edge point and its reflection.
  const candidates = [{ x: 1, y: cornerY }, { x: -1, y: cornerY }];
  for (const circle of circles) {
    const dx = point.x - circle.x;
    const dy = point.y - circle.y;
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length === 0) continue;
    const scale = circle.radius / length;
    const candidate = { x: circle.x + dx * scale, y: circle.y + dy * scale };
    if (inside(candidate)) candidates.push(candidate);
  }
  let closest = candidates[0];
  let distance = Math.hypot(point.x - closest.x, point.y - closest.y);
  for (const candidate of candidates.slice(1)) {
    const nextDistance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
    if (nextDistance < distance) { closest = candidate; distance = nextDistance; }
  }
  return { ...closest };
}

/**
 * The canonical leaf is [0,1] × [0,aspect], in page-width units.
 * C is the original outer-edge grip; D is its constrained planar target.
 * gripY optionally selects a continuous normalized edge position in [0,1].
 * Without gripY, corner retains its original top/bottom behavior.
 * vertical is a displacement in page-width units, not a normalized height.
 * Endpoints are exact flat leaves and ignore vertical. A continuous gesture
 * trajectory therefore brings vertical to zero as progress approaches 0 or 1.
 */
export function curlPose(progress, options = {}) {
  const phase = unit(progress, 'progress');
  const settings = optionsFor(options);
  const { aspect, corner, direction, mode, maxRadius } = settings;
  const gripY = settings.gripY ?? (corner === 'bottom' ? 1 : 0);
  const cornerY = gripY * aspect;
  const C = { x: 1, y: cornerY };
  const vertical = phase === 0 || phase === 1 ? 0 : settings.vertical;
  const rawD = { x: 1 - 2 * phase, y: cornerY + vertical };
  if (!Number.isFinite(rawD.y)) throw new RangeError('target coordinates must remain finite.');
  const D = projectTarget(rawD, aspect, cornerY);
  const delta = { x: C.x - D.x, y: C.y - D.y };
  const distance = Math.hypot(delta.x, delta.y);
  const n = distance > 0 ? { x: delta.x / distance, y: delta.y / distance } : { x: 1, y: 0 };
  const M = { x: C.x / 2 + D.x / 2, y: C.y / 2 + D.y / 2 };
  // The largest signed distance of either spine endpoint must remain outside
  // the bending strip. The disk projection makes this clearance nonnegative.
  const clearanceSpine = Math.max(0, Math.min(n.x * M.x + n.y * M.y, n.x * M.x + n.y * (M.y - aspect)));
  const effectiveRadius = phase === 0 || phase === 1 ? 0 : Math.max(0, Math.min(
    maxRadius * Math.sin(PI * phase),
    distance * .14,
    2 * clearanceSpine / PI,
  ));
  const halfWidth = PI * effectiveRadius / 2;
  return {
    progress: phase, direction, corner, gripY, vertical, aspect, mode, maxRadius,
    C, D, rawD, n, M, distance, clearanceSpine,
    radius: effectiveRadius, halfWidth,
    start: { x: M.x - n.x * halfWidth, y: M.y - n.y * halfWidth },
  };
}

function transformPoint(u, v, pose) {
  const { progress, direction, aspect, radius, halfWidth, n, M } = pose;
  if (progress === 0 || progress === 1) {
    return { x: (direction * (progress === 1 ? -u : u)) || 0, y: v, z: 0, normalX: 0, normalY: 0, normalZ: progress === 1 ? -1 : 1 };
  }
  let x = u;
  let y = v * aspect;
  let z = 0;
  let normalX = 0;
  let normalY = 0;
  let normalZ = 1;
  if (u !== 0) {
    const relativeX = x - M.x;
    const relativeY = y - M.y;
    const d = relativeX * n.x + relativeY * n.y;
    if (d >= halfWidth && (radius > 0 || d > 0)) {
      x -= 2 * d * n.x;
      y -= 2 * d * n.y;
      z = 2 * radius;
      normalZ = -1;
    } else if (radius > 0 && d > -halfWidth) {
      const theta = (d + halfWidth) / radius;
      const sine = Math.sin(theta);
      const cosine = Math.cos(theta);
      const tangentialX = relativeX - d * n.x;
      const tangentialY = relativeY - d * n.y;
      const curved = -halfWidth + radius * sine;
      x = M.x + tangentialX + n.x * curved;
      y = M.y + tangentialY + n.y * curved;
      z = radius * (1 - cosine);
      normalX = -n.x * sine;
      normalY = -n.y * sine;
      normalZ = cosine;
    }
  }
  const result = { x: direction * x, y: y / aspect, z, normalX: direction * normalX, normalY, normalZ };
  if (!Object.values(result).every(Number.isFinite)) throw new RangeError('curl coordinates must remain finite.');
  return result;
}

/** u and v are source UVs in [0,1]; returned y is in page-height units. */
export function curlPoint(u, v, progress, options = {}) {
  return transformPoint(unit(u, 'u'), unit(v, 'v'), curlPose(progress, options));
}

function sourceArea(a, b, c, aspect) {
  return (b.x - a.x) * ((c.y - a.y) / aspect) - ((b.y - a.y) / aspect) * (c.x - a.x);
}

function cleanPolygon(points, aspect) {
  const same = (a, b) => Math.abs(a.x - b.x) <= 1e-13 && Math.abs((a.y - b.y) / aspect) <= 1e-13;
  const result = [];
  for (const point of points) {
    if (!result.length || !same(result[result.length - 1], point)) result.push(point);
  }
  if (result.length > 1 && same(result[0], result[result.length - 1])) result.pop();
  let changed = true;
  while (changed && result.length >= 3) {
    changed = false;
    for (let i = 0; i < result.length; i += 1) {
      const before = result[(i + result.length - 1) % result.length];
      const current = result[i];
      const after = result[(i + 1) % result.length];
      if (Math.abs(sourceArea(before, current, after, aspect)) <= 1e-14) {
        result.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return result;
}

/** Convex clipping preserves the clockwise source winding of the rectangle. */
function clipBand(polygon, limit, above, pose) {
  if (!polygon.length) return [];
  const inside = (point) => above ? point.d >= limit : point.d <= limit;
  const result = [];
  let before = polygon[polygon.length - 1];
  let wasInside = inside(before);
  for (const point of polygon) {
    const isInside = inside(point);
    if (isInside !== wasInside) {
      const t = Math.max(0, Math.min(1, (limit - before.d) / (point.d - before.d)));
      let x = before.x + (point.x - before.x) * t;
      let y = before.y + (point.y - before.y) * t;
      // A strip's cut lines are parallel. Every new crossing lies on an
      // original rectangle edge; solve it directly so adjacent bands agree.
      if (before.x === point.x && pose.n.y !== 0) {
        x = point.x;
        y = pose.M.y + (limit - (x - pose.M.x) * pose.n.x) / pose.n.y;
      } else if (before.y === point.y && pose.n.x !== 0) {
        y = point.y;
        x = pose.M.x + (limit - (y - pose.M.y) * pose.n.y) / pose.n.x;
      }
      result.push({ x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(pose.aspect, y)), d: limit });
    }
    if (isInside) result.push(point);
    before = point;
    wasInside = isInside;
  }
  return cleanPolygon(result, pose.aspect);
}

/**
 * Adaptive curl mesh, partitioned along the fold's signed-distance coordinate.
 * The curved band always receives `segments` arc intervals, independent of
 * its width or angle; each flat region is a single clipped convex polygon.
 * x/z are page-width units; y is page-height units. Normals use physical axes.
 * UVs retain source coordinates. Direction mirrors x and normalX, while both
 * modes keep the spine fixed. Topology and UV/index buffers vary by pose.
 */
export function buildCurlMesh(progress, { segments = 32, ...options } = {}) {
  finite(segments, 'segments');
  if (!Number.isInteger(segments) || segments < 2 || segments > 128) throw new RangeError('segments must be an integer from 2 to 128.');
  const pose = curlPose(progress, options);
  const rectangle = [[0, 0], [0, pose.aspect], [1, pose.aspect], [1, 0]].map(([x, y]) => ({
    x, y, d: (x - pose.M.x) * pose.n.x + (y - pose.M.y) * pose.n.y,
  }));
  const minimum = Math.min(...rectangle.map((point) => point.d));
  const maximum = Math.max(...rectangle.map((point) => point.d));
  const limits = [minimum, maximum];
  if (pose.progress !== 0 && pose.progress !== 1) {
    if (pose.radius > 0) {
      for (let i = 0; i <= segments; i += 1) {
        const limit = -pose.halfWidth + 2 * pose.halfWidth * i / segments;
        if (limit > minimum && limit < maximum) limits.push(limit);
      }
    } else if (minimum < 0 && maximum > 0) limits.push(0);
  }
  limits.sort((a, b) => a - b);
  const cuts = limits.filter((limit, index) => index === 0 || limit !== limits[index - 1]);
  const vertices = [];
  const vertexIds = new Map();
  const triangles = [];

  function vertexId(point) {
    // Deduplicate at the precision actually uploaded to WebGL. This also
    // collapses imperceptibly thin slivers near exact flat endpoints.
    const u = Math.fround(Math.max(0, Math.min(1, point.x))) || 0;
    const v = Math.fround(Math.max(0, Math.min(1, point.y / pose.aspect))) || 0;
    const key = `${u}:${v}`;
    if (vertexIds.has(key)) return vertexIds.get(key);
    const transformed = transformPoint(u, v, pose);
    const position = [transformed.x, transformed.y, transformed.z].map(Math.fround);
    const normal = [transformed.normalX, transformed.normalY, transformed.normalZ].map(Math.fround);
    if (![...position, ...normal].every(Number.isFinite)) throw new RangeError('mesh coordinates must fit in Float32.');
    const index = vertices.length;
    vertices.push({ u, v, position, normal });
    vertexIds.set(key, index);
    return index;
  }

  function addTriangle(a, b, c) {
    if (a === b || b === c || c === a) return;
    const A = vertices[a], B = vertices[b], C = vertices[c];
    const winding = (B.u - A.u) * (C.v - A.v) - (B.v - A.v) * (C.u - A.u);
    if (winding >= 0) return;
    const ab = B.position.map((value, index) => (value - A.position[index]) * (index === 1 ? pose.aspect : 1));
    const ac = C.position.map((value, index) => (value - A.position[index]) * (index === 1 ? pose.aspect : 1));
    const area = Math.hypot(ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]);
    if (area === 0) return;
    triangles.push(a, b, c);
  }

  for (let i = 0; i < cuts.length - 1; i += 1) {
    const polygon = clipBand(clipBand(rectangle, cuts[i], true, pose), cuts[i + 1], false, pose);
    if (polygon.length < 3) continue;
    const ids = polygon.map(vertexId);
    for (let j = 1; j < ids.length - 1; j += 1) addTriangle(ids[0], ids[j], ids[j + 1]);
  }
  // Remove unused vertices from any sliver that collapsed after Float32 upload.
  const remap = new Map();
  const positions = [], normals = [], uvs = [], indices = [];
  for (const original of triangles) {
    if (!remap.has(original)) {
      const vertex = vertices[original];
      remap.set(original, remap.size);
      positions.push(...vertex.position);
      normals.push(...vertex.normal);
      uvs.push(vertex.u, vertex.v);
    }
    indices.push(remap.get(original));
  }
  return {
    positions: new Float32Array(positions), normals: new Float32Array(normals),
    uvs: new Float32Array(uvs), indices: new Uint16Array(indices), pose,
  };
}
