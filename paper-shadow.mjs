// Independent shadow footprint from the lifted paper mesh; no external renderer code.
const LIFT_EPSILON = 1e-5;
const MAX_OPACITY = .15;
const FLOAT32_MAX = 3.4028234663852886e38;

function finite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number.`);
  }
  return value;
}

function drawable(value) {
  if (!Number.isFinite(value) || Math.abs(value) > FLOAT32_MAX) {
    throw new RangeError('shadow coordinates must fit in Float32.');
  }
  return value;
}

function empty(maxLift = 0) {
  return {
    positions: new Float32Array(0), normals: new Float32Array(0), indices: new Uint16Array(0),
    hullCount: 0, vertexCount: 0, maxLift, falloff: 0, opacity: 0, bounds: null,
  };
}

function cross(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function convexHull(points) {
  points.sort((a, b) => a.x - b.x || a.y - b.y);
  const unique = points.filter((point, index) => index === 0
    || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
  if (unique.length < 3) return [];
  const lower = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let i = unique.length - 1; i >= 0; i -= 1) {
    const point = unique[i];
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  const hull = lower.concat(upper);
  return hull.length >= 3 ? hull : [];
}

function outerRing(hull, center, falloff) {
  const count = hull.length;
  const ring = hull.map((point, i) => {
    const before = hull[(i + count - 1) % count];
    const after = hull[(i + 1) % count];
    const dx0 = point.x - before.x;
    const dy0 = point.y - before.y;
    const dx1 = after.x - point.x;
    const dy1 = after.y - point.y;
    const length0 = Math.hypot(dx0, dy0);
    const length1 = Math.hypot(dx1, dy1);
    const nx0 = dy0 / length0;
    const ny0 = -dx0 / length0;
    const nx1 = dy1 / length1;
    const ny1 = -dx1 / length1;
    const length = Math.hypot(nx0 + nx1, ny0 + ny1);
    const nx = (nx0 + nx1) / length;
    const ny = (ny0 + ny1) / length;
    const distance = Math.min(falloff / Math.max(nx * nx1 + ny * ny1, 1e-6), 2 * falloff);
    return { x: point.x + nx * distance, y: point.y + ny * distance };
  });
  // Very acute or near-degenerate corners must not turn the falloff band inside out.
  const valid = ring.every((point, i) => {
    const next = (i + 1) % count;
    return Number.isFinite(point.x) && Number.isFinite(point.y)
      && cross(hull[i], point, ring[next]) > 0
      && cross(hull[i], ring[next], hull[next]) > 0;
  });
  if (valid) return ring;
  // Radial expansion retains cyclic ordering and bounds spikes even on a thin hull.
  return hull.map((point) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const distance = Math.hypot(dx, dy);
    return { x: point.x + dx / distance * falloff, y: point.y + dy / distance * falloff };
  });
}

/**
 * Project lifted W/H-normalized vertices onto the paper plane in CSS pixels.
 * The mesh already contains the turn direction. Triangle-adjacent flat vertices
 * anchor the contact line without adding the unrelated flat page to the hull.
 * The inner hull covers both the unshifted silhouette and its light projection:
 * a directional penumbra must not detach the shadow from a raised edge or tip.
 * The center and inner hull carry
 * lift-dependent alpha in normals.x; the outer ring carries zero, interpolated
 * by triangles. Opacity grows smoothly to .15 over the first 6 CSS pixels.
 * Layout: center, inner hull, outer hull. No viewport clipping is applied here.
 */
export function buildPaperShadow(mesh, scene) {
  const source = mesh?.positions;
  if (!source || !Number.isInteger(source.length)) throw new TypeError('mesh.positions must be an array of xyz coordinates.');
  if (source.length % 3 !== 0) throw new RangeError('mesh.positions must contain complete xyz vertices.');
  const spine = finite(scene?.spine, 'scene.spine');
  const top = finite(scene?.y, 'scene.y');
  const width = finite(scene?.pageWidth, 'scene.pageWidth');
  const height = finite(scene?.pageHeight, 'scene.pageHeight');
  if (width <= 0 || height <= 0) throw new RangeError('page dimensions must be greater than zero.');
  const silhouette = [];
  const projection = [];
  let maxLift = 0;
  const contact = new Set();
  // Keep the exact contact line in the footprint. Sampling only z>0 leaves a
  // light gap where the curved strip meets the still-flat part of this leaf.
  // Do not include arbitrary flat vertices: that would darken the whole page.
  const triangles = mesh.indices;
  if (triangles) {
    if (!Number.isInteger(triangles.length) || triangles.length % 3 !== 0) {
      throw new RangeError('mesh.indices must contain complete triangles.');
    }
    for (let i = 0; i < triangles.length; i += 3) {
      const ids = [triangles[i], triangles[i + 1], triangles[i + 2]];
      if (!ids.every((index) => Number.isInteger(index) && index >= 0 && index < source.length / 3)) {
        throw new RangeError('mesh.indices must reference existing vertices.');
      }
      if (ids.some((index) => source[index * 3 + 2] > LIFT_EPSILON)) {
        for (const index of ids) {
          const z = source[index * 3 + 2];
          if (z >= 0 && z <= LIFT_EPSILON) contact.add(index);
        }
      }
    }
  }
  for (let i = 0; i < source.length; i += 3) {
    const x = finite(source[i], 'mesh x');
    const y = finite(source[i + 1], 'mesh y');
    const z = finite(source[i + 2], 'mesh z');
    if (z <= LIFT_EPSILON && !contact.has(i / 3)) continue;
    const lift = drawable(z * width);
    maxLift = Math.max(maxLift, lift);
    const point = {
      x: drawable(spine + x * width),
      y: drawable(top + y * height),
    };
    silhouette.push(point);
    projection.push({
      x: drawable(point.x + lift * .35),
      y: drawable(point.y + lift * .175),
    });
  }
  // A translated blur alone can miss the original outline when lift exceeds
  // its bounded radius. Keep that outline inside the opaque inner footprint,
  // then feather outward. Depth/clipping still hides the part under the leaf.
  if (convexHull([...silhouette]).length < 3) return empty(maxLift);
  const rawHull = convexHull([...silhouette, ...projection]);
  if (1 + rawHull.length * 2 > 65536) throw new RangeError('shadow hull exceeds Uint16 index capacity.');
  // The original and translated contours can approach within less than one
  // Float32 unit at their contact. Rebuild at upload precision so no zero-length
  // edge can break the penumbra extrusion or create a sliver at that joint.
  const hull = convexHull(rawHull.map(({ x, y }) => ({ x: Math.fround(x), y: Math.fround(y) })));
  if (hull.length < 3) return empty(maxLift);
  const count = hull.length;
  const vertexCount = 1 + count * 2;
  if (vertexCount > 65536) throw new RangeError('shadow hull exceeds Uint16 index capacity.');
  const falloff = Math.max(3, Math.min(24, 3 + maxLift * .65));
  const rise = Math.max(0, Math.min(1, maxLift / 6));
  const opacity = MAX_OPACITY * rise * rise * (3 - 2 * rise);
  const center = { x: 0, y: 0 };
  for (const point of hull) { center.x += point.x / count; center.y += point.y / count; }
  const outer = outerRing(hull, center, falloff);
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const indices = new Uint16Array(count * 9);
  const vertices = [center, ...hull, ...outer];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < vertices.length; i += 1) {
    positions[i * 3] = drawable(vertices[i].x);
    positions[i * 3 + 1] = drawable(vertices[i].y);
    normals[i * 3] = i <= count ? opacity : 0;
    minX = Math.min(minX, positions[i * 3]);
    minY = Math.min(minY, positions[i * 3 + 1]);
    maxX = Math.max(maxX, positions[i * 3]);
    maxY = Math.max(maxY, positions[i * 3 + 1]);
  }
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    const inner = 1 + i;
    const innerNext = 1 + next;
    const edge = 1 + count + i;
    const edgeNext = 1 + count + next;
    indices.set([0, inner, innerNext, inner, edge, edgeNext, inner, edgeNext, innerNext], i * 9);
  }
  return {
    positions, normals, indices, hullCount: count, vertexCount, maxLift, falloff, opacity,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}
