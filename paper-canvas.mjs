import { buildPaperShadow } from './paper-shadow.mjs?v=20261029-curl8';
import { shadeAtVertex } from './paper-lighting.mjs?v=20261029-curl8';

const MAX_PIXELS = 4_000_000;
const MAX_DPR = 1.25;

function finite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number.`);
  return value;
}

function positive(value, name) {
  finite(value, name);
  if (value <= 0) throw new RangeError(`${name} must be greater than zero.`);
  return value;
}

function texture(source) {
  if (!source) return null;
  return {
    source,
    width: positive(source.naturalWidth || source.videoWidth || source.width, 'texture width'),
    height: positive(source.naturalHeight || source.videoHeight || source.height, 'texture height'),
  };
}

function trianglePath(context, points) {
  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);
  context.lineTo(points[1][0], points[1][1]);
  context.lineTo(points[2][0], points[2][1]);
  context.closePath();
}

function triangleTexture(context, triangle) {
  const { points, image, uv } = triangle;
  let transform;
  if (image) {
    const source = uv.map(([u, v]) => [u * image.width, v * image.height]);
    const du1 = source[1][0] - source[0][0], dv1 = source[1][1] - source[0][1];
    const du2 = source[2][0] - source[0][0], dv2 = source[2][1] - source[0][1];
    const determinant = du1 * dv2 - du2 * dv1;
    if (Math.abs(determinant) < 1e-8) return;
    const dx1 = points[1][0] - points[0][0], dy1 = points[1][1] - points[0][1];
    const dx2 = points[2][0] - points[0][0], dy2 = points[2][1] - points[0][1];
    const a = (dx1 * dv2 - dx2 * dv1) / determinant;
    const b = (dy1 * dv2 - dy2 * dv1) / determinant;
    const c = (dx2 * du1 - dx1 * du2) / determinant;
    const d = (dy2 * du1 - dy1 * du2) / determinant;
    transform = [a, b, c, d, points[0][0] - a * source[0][0] - c * source[0][1], points[0][1] - b * source[0][0] - d * source[0][1]];
  }
  context.save();
  try {
    trianglePath(context, points);
    context.clip();
    if (image) {
      context.transform(...transform);
      context.drawImage(image.source, 0, 0);
    } else {
      context.fillStyle = '#fbf9f5';
      context.fill();
    }
  } finally { context.restore(); }
}

function drawShadow(context, shadow, maxOpacity = .15) {
  const { positions, normals, indices } = shadow;
  const color = (alpha) => `rgba(14,23,31,${alpha})`;
  for (let offset = 0; offset < indices.length; offset += 3) {
    const points = [], alpha = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const index = indices[offset + corner];
      points.push([positions[index * 3], positions[index * 3 + 1]]);
      alpha.push(Math.max(0, Math.min(maxOpacity, normals[index * 3])));
    }
    const low = Math.min(...alpha), high = Math.max(...alpha);
    if (high === 0) continue;
    const dx1 = points[1][0] - points[0][0], dy1 = points[1][1] - points[0][1];
    const dx2 = points[2][0] - points[0][0], dy2 = points[2][1] - points[0][1];
    const determinant = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(determinant) < 1e-6) continue;
    let fill = color(high);
    if (high > low) {
      const da1 = alpha[1] - alpha[0], da2 = alpha[2] - alpha[0];
      const gx = (da1 * dy2 - da2 * dy1) / determinant;
      const gy = (dx1 * da2 - dx2 * da1) / determinant;
      const square = gx * gx + gy * gy;
      const from = (low - alpha[0]) / square;
      const to = (high - alpha[0]) / square;
      fill = context.createLinearGradient(points[0][0] + gx * from, points[0][1] + gy * from, points[0][0] + gx * to, points[0][1] + gy * to);
      fill.addColorStop(0, color(low));
      fill.addColorStop(1, color(high));
    }
    context.beginPath();
    context.moveTo(...points[0]);
    context.lineTo(...points[1]);
    context.lineTo(...points[2]);
    context.closePath();
    context.fillStyle = fill;
    context.fill();
  }
}

/** Canvas 2D fallback for the same CPU mesh used by the WebGL paper surface. */
export function createCanvasPaperSurface(canvas, front, back, scene) {
  if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('canvas must provide a 2D context.');
  if (!scene || typeof scene !== 'object') throw new TypeError('scene must describe the page projection.');
  const width = positive(scene.width, 'scene.width');
  const height = positive(scene.height, 'scene.height');
  const pageWidth = positive(scene.pageWidth, 'scene.pageWidth');
  const pageHeight = positive(scene.pageHeight, 'scene.pageHeight');
  const spine = finite(scene.spine, 'scene.spine');
  const y = finite(scene.y, 'scene.y');
  const direction = finite(scene.direction, 'scene.direction');
  if (direction !== 1 && direction !== -1) throw new RangeError('scene.direction must be 1 or -1.');
  const mode = scene.mode || 'double';
  if (mode !== 'double' && mode !== 'single') throw new TypeError('scene.mode must be double or single.');
  const x = finite(scene.x, 'scene.x');
  const shadowScene = { spine, y, pageWidth, pageHeight };
  if (!Number.isFinite(width * height)) throw new RangeError('scene area is too large.');
  let textures = [texture(front), texture(back)];
  let context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('Canvas 2D is unavailable.');
  const deviceScale = Number.isFinite(globalThis.devicePixelRatio) && globalThis.devicePixelRatio > 0 ? globalThis.devicePixelRatio : 1;
  const scale = Math.min(deviceScale, MAX_DPR, Math.sqrt(MAX_PIXELS / (width * height)));
  let pixelWidth = Math.max(1, Math.floor(width * scale));
  let pixelHeight = Math.max(1, Math.floor(height * scale));
  if (pixelWidth * pixelHeight > MAX_PIXELS) {
    if (pixelWidth >= pixelHeight) pixelWidth = Math.floor(MAX_PIXELS / pixelHeight);
    else pixelHeight = Math.floor(MAX_PIXELS / pixelWidth);
  }
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  if (canvas.style) { canvas.style.width = `${width}px`; canvas.style.height = `${height}px`; }
  const scaleX = pixelWidth / width;
  const scaleY = pixelHeight / height;
  let disposed = false;

  function draw(mesh, progress) {
    if (disposed) return;
    finite(progress, 'progress');
    const { positions, uvs, indices } = mesh || {};
    if (!positions || positions.length % 3 !== 0 || !uvs || uvs.length !== positions.length / 3 * 2 || !indices || indices.length % 3 !== 0) {
      throw new TypeError('mesh must contain complete positions, UVs and triangle indices.');
    }
    const vertexCount = positions.length / 3;
    const triangles = [];
    for (let offset = 0; offset < indices.length; offset += 3) {
      const points = [], uv = [];
      for (let corner = 0; corner < 3; corner += 1) {
        const index = indices[offset + corner];
        if (!Number.isInteger(index) || index < 0 || index >= vertexCount) throw new RangeError('mesh index is outside the vertex array.');
        const px = finite(positions[index * 3], 'mesh x');
        const py = finite(positions[index * 3 + 1], 'mesh y');
        const pz = finite(positions[index * 3 + 2], 'mesh z');
        points.push([spine + px * pageWidth, y + py * pageHeight, pz]);
        uv.push([finite(uvs[index * 2], 'mesh u'), finite(uvs[index * 2 + 1], 'mesh v')]);
      }
      const area = (points[1][0] - points[0][0]) * (points[2][1] - points[0][1]) - (points[1][1] - points[0][1]) * (points[2][0] - points[0][0]);
      if (!Number.isFinite(area) || Math.abs(area) < 1e-6) continue;
      const frontFacing = area * direction < 0;
      const mirror = frontFacing ? direction < 0 : direction > 0;
      triangles.push({
        points, image: textures[frontFacing ? 0 : 1],
        shades: Array.from(indices.slice(offset, offset + 3), (index) => shadeAtVertex(mesh, index, frontFacing)),
        uv: uv.map(([u, v]) => [mirror ? 1 - u : u, v]),
        depth: points[0][2] / 3 + points[1][2] / 3 + points[2][2] / 3,
        order: offset,
      });
    }
    triangles.sort((a, b) => a.depth - b.depth || a.order - b.order);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    const shadow = buildPaperShadow(mesh, shadowScene);
    const shadowReceiverHeight = (mesh.pose?.radius || 0) + 1e-5;
    if (shadow.indices.length) {
      context.save();
      try {
        context.beginPath();
        context.rect(x, y, pageWidth * (mode === 'double' ? 2 : 1), pageHeight);
        context.clip();
        drawShadow(context, shadow);
      } finally { context.restore(); }
    }
    context.save();
    try {
      if (mode === 'single') {
        context.beginPath();
        context.rect(x, y, pageWidth, pageHeight);
        context.clip();
      }
      for (const triangle of triangles) {
        triangleTexture(context, triangle);
        if (triangle.shades.some((shade) => shade < .99999)) {
          drawShadow(context, {
            positions: triangle.points.flat(),
            normals: triangle.shades.flatMap((shade) => [1 - shade, 0, 0]),
            indices: [0, 1, 2],
          }, .4);
        }
        // The flat sheet and lower half of the curl receive the fold's shadow.
        // Clip after their opaque texture; the higher back of the fold is
        // painted later and continues to occlude this projection.
        if (shadow.indices.length && triangle.points.every((point) => point[2] <= shadowReceiverHeight)) {
          context.save();
          try {
            trianglePath(context, triangle.points);
            context.clip();
            drawShadow(context, shadow);
          } finally { context.restore(); }
        }
      }
    } finally { context.restore(); }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    textures = null;
    context = null;
    canvas.width = 0;
    canvas.height = 0;
  }

  return { draw, dispose };
}
