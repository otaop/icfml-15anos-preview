// Keep PDF.js text-item order and characters; only its explicit line breaks
// become newlines. No editorial rewrite, inferred heading or OCR is introduced.
export function textFromPdfContent(content) {
  if (!content || !Array.isArray(content.items)) throw new TypeError("PDF text content is unavailable");
  return content.items.filter((item) => typeof item.str === "string")
    .map((item) => item.str + (item.hasEOL ? "\n" : "")).join("");
}

export async function loadPageText(pdf, number, loadedPages, cache) {
  if (cache.has(number)) return cache.get(number);
  const pending = (async () => {
    let page = loadedPages.get(number);
    if (!page) { page = await pdf.getPage(number); loadedPages.set(number, page); }
    return textFromPdfContent(await page.getTextContent({ disableNormalization: true, includeMarkedContent: false }));
  })();
  cache.set(number, pending);
  try { return await pending; }
  catch (error) { if (cache.get(number) === pending) cache.delete(number); throw error; }
}
