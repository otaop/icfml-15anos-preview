function copyCanvas(source) {
  if (!source) return null;
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  canvas.getContext('2d').drawImage(source, 0, 0);
  canvas.setAttribute('aria-hidden', 'true');
  return canvas;
}

/** Owns the static sheets under one temporary paper surface. Completion is synchronous. */
export function createPaperLayers({ host, old, fresh, direction, geometry, isCurrent }) {
  let mounted = false;
  let cleaned = false;
  let hiddenSheet;
  let stationary;
  return {
    mount() {
      if (mounted || cleaned || !isCurrent()) return;
      mounted = true;
      host.replaceChildren(fresh.element);
      if (geometry.mode !== 'double') return;
      const receiving = direction < 0 ? 1 : 0;
      hiddenSheet = fresh.element.children[receiving];
      hiddenSheet.style.visibility = 'hidden';
      const canvas = copyCanvas(old.canvases[receiving]);
      if (!canvas) return;
      stationary = document.createElement('div');
      stationary.className = 'turn-stationary';
      stationary.setAttribute('aria-hidden', 'true');
      stationary.style.left = `${receiving * geometry.pageWidth}px`;
      stationary.style.width = `${geometry.pageWidth}px`;
      stationary.append(canvas);
      host.append(stationary);
    },
    complete(committed) {
      if (cleaned) return;
      cleaned = true;
      if (hiddenSheet) hiddenSheet.style.visibility = '';
      if (stationary) {
        const canvas = stationary.querySelector('canvas');
        canvas.width = 0;
        canvas.height = 0;
        stationary.remove();
      }
      if (!isCurrent()) return;
      host.replaceChildren(committed ? fresh.element : old.element);
    },
  };
}
