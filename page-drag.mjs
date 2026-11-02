function finite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number.`);
  }
  return value;
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

function displayMode(mode) {
  if (mode !== 'double' && mode !== 'single') {
    throw new TypeError('mode must be double or single.');
  }
}

/** Client-coordinate hit test. Small rectangles shrink corner zones to prevent overlap. */
export function cornerDirection(x, y, rect, { mode = 'double', canPrevious = true, canNext = true, cornerSize = 80 } = {}) {
  finite(x, 'x');
  finite(y, 'y');
  displayMode(mode);
  if (!rect || typeof rect !== 'object') throw new TypeError('rect must describe a rectangle.');
  const left = finite(rect.left, 'rect.left');
  const top = finite(rect.top, 'rect.top');
  const width = finite(rect.width, 'rect.width');
  const height = finite(rect.height, 'rect.height');
  if (width <= 0 || height <= 0) throw new RangeError('rect dimensions must be greater than zero.');
  if (typeof canPrevious !== 'boolean' || typeof canNext !== 'boolean') {
    throw new TypeError('canPrevious and canNext must be booleans.');
  }
  const size = Math.min(Math.max(40, finite(cornerSize, 'cornerSize')), 90, width * .25, height * .3);
  const localX = x - left;
  const localY = y - top;
  if (localX < 0 || localX > width || localY < 0 || localY > height) return 0;
  if (localY > size && localY < height - size) return 0;
  if (localX >= width - size && canNext) return 1;
  if (localX <= size && canPrevious) return -1;
  return 0;
}

/** A physical leaf travels two page widths. Single mode completes the hidden half after release. */
export function dragProgress(startX, currentX, { direction = 1, pageWidth, mode = 'double', initialProgress = 0 } = {}) {
  finite(startX, 'startX');
  finite(currentX, 'currentX');
  finite(direction, 'direction');
  finite(pageWidth, 'pageWidth');
  finite(initialProgress, 'initialProgress');
  displayMode(mode);
  if (direction !== 1 && direction !== -1) throw new RangeError('direction must be 1 or -1.');
  if (pageWidth <= 0) throw new RangeError('pageWidth must be greater than zero.');
  const displacement = startX - currentX;
  const widths = Number.isFinite(displacement) ? displacement / pageWidth : startX / pageWidth - currentX / pageWidth;
  return clamp(initialProgress + direction * widths / 2);
}

/** Velocity is signed progress per second; a deliberate reverse flick cancels. */
export function releaseDecision(progress, velocity, { canceled = false, mode = 'double' } = {}) {
  displayMode(mode);
  if (typeof canceled !== 'boolean') throw new TypeError('canceled must be a boolean.');
  if (canceled) return false;
  const position = clamp(finite(progress, 'progress'));
  finite(velocity, 'velocity');
  if (velocity < -.65) return false;
  return position >= (mode === 'single' ? .25 : .5) || (position > .08 && velocity > .65);
}

/** Samples use milliseconds. Only distinct timestamps within [now-maxAge,now] contribute. */
export function sampleVelocity(samples, now, { maxAge = 100 } = {}) {
  if (!Array.isArray(samples)) throw new TypeError('samples must be an array.');
  finite(now, 'now');
  finite(maxAge, 'maxAge');
  if (maxAge <= 0) throw new RangeError('maxAge must be greater than zero.');
  const recent = new Map();
  for (const sample of samples) {
    if (!sample || typeof sample !== 'object') throw new TypeError('each sample must contain time and progress.');
    const time = finite(sample.time, 'sample.time');
    const progress = clamp(finite(sample.progress, 'sample.progress'));
    if (time >= now - maxAge && time <= now) recent.set(time, progress);
  }
  if (recent.size < 2) return 0;
  const ordered = [...recent.entries()].sort(([a], [b]) => a - b);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const elapsed = last[0] - first[0];
  const velocity = (last[1] - first[1]) * 1000 / elapsed;
  return Number.isFinite(velocity) ? velocity : 0;
}
