function finite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number.`);
  return value;
}

function positive(value, name) {
  finite(value, name);
  if (value <= 0) throw new RangeError(`${name} must be greater than zero.`);
  return value;
}

/** Small pointer-following poses on the outer strips of a page or spread. */
export function hoverPose(x, y, rect, {
  pageWidth, aspect, mode = 'double', canPrevious = true, canNext = true,
  reducedMotion = false, pointerType = 'mouse', zoom = 1,
} = {}) {
  finite(x, 'x');
  finite(y, 'y');
  if (!rect || typeof rect !== 'object') throw new TypeError('rect must describe a rectangle.');
  const left = finite(rect.left, 'rect.left');
  const top = finite(rect.top, 'rect.top');
  const width = positive(rect.width, 'rect.width');
  const height = positive(rect.height, 'rect.height');
  positive(pageWidth, 'pageWidth');
  positive(aspect, 'aspect');
  positive(zoom, 'zoom');
  if (mode !== 'double' && mode !== 'single') throw new TypeError('mode must be double or single.');
  if (typeof canPrevious !== 'boolean' || typeof canNext !== 'boolean' || typeof reducedMotion !== 'boolean') {
    throw new TypeError('navigation permissions and reducedMotion must be booleans.');
  }
  if (pointerType !== 'mouse' || reducedMotion || zoom !== 1) return null;
  const localX = x - left;
  const localY = y - top;
  if (localX < 0 || localX > width || localY < 0 || localY > height) return null;
  const strip = Math.max(32, Math.min(72, pageWidth * .12));
  let direction;
  if (localX <= strip && localX < width / 2) direction = -1;
  else if (localX >= width - strip && localX > width / 2) direction = 1;
  else return null;
  if (direction === -1 ? !canPrevious : !canNext) return null;
  const gripY = Math.max(0, Math.min(1, localY / height));
  const corner = gripY < .5 ? 'top' : 'bottom';
  const distance = direction < 0 ? localX : width - localX;
  const strength = Math.max(0, Math.min(1, 1 - distance / strip));
  return {
    direction, corner, gripY,
    progress: .025 + .02 * strength,
    vertical: aspect * (.04 + .04 * strength) * Math.cos(Math.PI * gripY),
  };
}
