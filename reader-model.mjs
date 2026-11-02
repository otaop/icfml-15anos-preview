function assertTotal(total) {
  if (!Number.isSafeInteger(total) || total < 1) {
    throw new RangeError('total must be a positive safe integer.');
  }
}

/** Wide desktop windows and landscape screens show the physical facing pages. */
export function displayMode(width, height) {
  for (const [name, value] of [['width', width], ['height', height]]) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`${name} must be a finite number.`);
    }
    if (value <= 0) throw new RangeError(`${name} must be greater than zero.`);
  }
  return width >= 900 || width > height ? 'double' : 'single';
}

/** Rounds a finite number or complete numeric string into 1..total; invalid input becomes 1. */
export function clampPage(value, total) {
  assertTotal(total);
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() !== ''
      ? Number(value)
      : NaN;
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(total, Math.max(1, Math.round(numeric)));
}

/**
 * Returns the real page numbers in reading order and the first real page as anchor.
 * In double mode the front cover is [null, 1], then even/odd pairs; an unpaired
 * even final page is [total, null]. Single mode has exactly one real page.
 * total must be a positive safe integer; mode must be double or single.
 */
export function spreadForPage(page, total, mode = 'double') {
  if (mode !== 'double' && mode !== 'single') {
    throw new TypeError('mode must be double or single.');
  }
  const current = clampPage(page, total);
  if (mode === 'single') return { pages: [current], anchor: current };
  if (current === 1) return { pages: [null, 1], anchor: 1 };
  const anchor = current % 2 === 0 ? current : current - 1;
  return { pages: [anchor, anchor < total ? anchor + 1 : null], anchor };
}

export function nextPage(page, total, mode = 'double') {
  const spread = spreadForPage(page, total, mode);
  const last = spread.pages[spread.pages.length - 1] ?? spread.anchor;
  return last === total ? spread.anchor : last + 1;
}

export function previousPage(page, total, mode = 'double') {
  const { anchor } = spreadForPage(page, total, mode);
  return mode === 'single' ? Math.max(1, anchor - 1) : anchor <= 2 ? 1 : anchor - 2;
}
