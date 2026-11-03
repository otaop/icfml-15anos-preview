// Fetch the public parser while access is checked, without requesting the PDF.
// Observe an import failure immediately, even if authorization finishes first.
export async function loadAuthorizedReaderLibrary({ authorize, loadLibrary }) {
  const library = Promise.resolve().then(loadLibrary).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );
  if ((await authorize()) !== true) return null;
  const result = await library;
  if (!result.ok) throw result.error;
  return result.value;
}
