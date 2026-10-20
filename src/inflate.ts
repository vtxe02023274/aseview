/** Inflate for the browser, to pass to readAse. */
export async function inflate(data: Uint8Array): Promise<Uint8Array> {
  // "deflate" in DecompressionStream is the zlib format Aseprite uses.
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
