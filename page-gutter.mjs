function positive(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number.`);
  if (value <= 0) throw new RangeError(`${name} must be greater than zero.`);
  return value;
}

/** Width in CSS pixels, before conversion to the page canvas resolution. */
export function gutterWidth(pageWidth) {
  return Math.max(14, Math.min(32, positive(pageWidth, 'pageWidth') * .045));
}

/** Paint once after rendering. A null side leaves even the 2D context untouched. */
export function applyPageGutter(canvas, { side, pageWidth } = {}) {
  if (side === null) return canvas;
  if (side !== 'left' && side !== 'right') throw new TypeError('side must be left, right or null.');
  const cssWidth = gutterWidth(pageWidth);
  if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('canvas must provide a 2D context.');
  const width = positive(canvas.width, 'canvas.width');
  const height = positive(canvas.height, 'canvas.height');
  const stripe = cssWidth * (width / pageWidth);
  if (!Number.isFinite(stripe)) throw new RangeError('gutter scale is too large.');
  const edge = side === 'left' ? 0 : width;
  const end = side === 'left' ? stripe : width - stripe;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable.');
  context.save();
  try {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    const gradient = context.createLinearGradient(edge, 0, end, 0);
    gradient.addColorStop(0, 'rgba(21,44,62,.13)');
    gradient.addColorStop(1, 'rgba(21,44,62,0)');
    context.fillStyle = gradient;
    context.fillRect(Math.min(edge, end), 0, stripe, height);
  } finally { context.restore(); }
  return canvas;
}
