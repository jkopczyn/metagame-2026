import { describe, expect, it, vi } from "vitest";
import { startCamera } from "./camera";

const fakeStream = () => {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] }, track };
};

describe("startCamera", () => {
  it("returns the stream and decoder once both are ready and attached", async () => {
    const { stream, track } = fakeStream();
    const attach = vi.fn(async () => {});
    const started = await startCamera({
      getMedia: async () => stream,
      decoder: Promise.resolve("jsqr"),
      attach,
    });
    expect(started).toEqual({ stream, decoder: "jsqr" });
    expect(attach).toHaveBeenCalledWith(stream);
    expect(track.stop).not.toHaveBeenCalled();
  });

  it("stops the camera when the decoder fails to load", async () => {
    const { stream, track } = fakeStream();
    await expect(
      startCamera({
        getMedia: async () => stream,
        decoder: Promise.reject(new Error("chunk")),
        attach: async () => {},
      }),
    ).rejects.toThrow("chunk");
    expect(track.stop).toHaveBeenCalled();
  });

  it("stops the camera when playback fails to start", async () => {
    const { stream, track } = fakeStream();
    await expect(
      startCamera({
        getMedia: async () => stream,
        decoder: Promise.resolve("jsqr"),
        attach: async () => {
          throw new Error("play");
        },
      }),
    ).rejects.toThrow("play");
    expect(track.stop).toHaveBeenCalled();
  });

  it("reports the camera error and not the decoder's when both fail", async () => {
    await expect(
      startCamera({
        getMedia: async () => {
          throw new Error("denied");
        },
        decoder: Promise.reject(new Error("chunk")),
        attach: async () => {},
      }),
    ).rejects.toThrow("denied");
  });
});
