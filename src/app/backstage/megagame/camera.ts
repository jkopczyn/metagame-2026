type Stream = { getTracks(): { stop(): void }[] };

export const stopStream = (stream: Stream) =>
  stream.getTracks().forEach((t) => t.stop());

/** Opens the camera, then stops it again if anything after that fails. */
export async function startCamera<S extends Stream, D>(steps: {
  getMedia: () => Promise<S>;
  decoder: Promise<D>;
  attach: (stream: S) => Promise<void>;
}): Promise<{ stream: S; decoder: D }> {
  // Loaded alongside the camera prompt; a camera failure is the one reported.
  steps.decoder.catch(() => {});
  const stream = await steps.getMedia();
  try {
    const decoder = await steps.decoder;
    await steps.attach(stream);
    return { stream, decoder };
  } catch (err) {
    stopStream(stream);
    throw err;
  }
}
