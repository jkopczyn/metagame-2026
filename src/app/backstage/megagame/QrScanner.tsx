"use client";

import { useEffect, useRef, useState } from "react";
import { startCamera, stopStream } from "./camera";
import { repeatGate } from "./scan-gate";

const FRAME_MS = 250;
// jsQR's cost grows with pixel count; a badge held at arm's length still
// decodes at this size.
const MAX_SIDE = 480;
const REPEAT_MS = 3000;

type Status = "starting" | "scanning" | "error";

function cameraError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access was refused. Allow it in the browser's settings, or type it in instead.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No camera was found. Type it in instead.";
  }
  if (name === "NotReadableError") {
    return "The camera is in use by another app. Close it and try again.";
  }
  return "The camera could not start. Type it in instead.";
}

/**
 * Reads QR codes from the camera with jsQR on a small canvas a few times a
 * second. BarcodeDetector is not used because no iOS browser has it.
 * `onDecode` returns a message to show, and no frame is read while it runs.
 */
export default function QrScanner({
  onDecode,
}: {
  onDecode: (payload: string) => Promise<string | null>;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const handler = useRef(onDecode);
  const [status, setStatus] = useState<Status>("starting");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    handler.current = onDecode;
  }, [onDecode]);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const gate = repeatGate(REPEAT_MS);

    async function start() {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!navigator.mediaDevices?.getUserMedia || !ctx) {
        setStatus("error");
        setMessage(
          "This browser can't use the camera on this page. Type it in instead.",
        );
        return;
      }
      try {
        const { decoder: jsqr } = await startCamera({
          getMedia: () =>
            navigator.mediaDevices.getUserMedia({
              audio: false,
              video: {
                facingMode: { ideal: "environment" },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              },
            }),
          decoder: import("jsqr"),
          attach: async (media) => {
            stream = media;
            if (stopped) throw new Error("stopped");
            const el = video.current!;
            el.srcObject = media;
            await el.play();
          },
        });
        if (stopped) return;
        const el = video.current!;
        setStatus("scanning");
        const scan = async () => {
          if (stopped) return;
          let payload: string | null = null;
          try {
            payload = readFrame(el, canvas, ctx, jsqr.default);
          } catch {
            setMessage("That frame could not be read. Keep the code in view.");
          }
          if (payload && gate.accept(payload, Date.now())) {
            try {
              setMessage(await handler.current(payload));
            } catch {
              setMessage("Something went wrong. Try again.");
            }
          }
          if (!stopped) timer = setTimeout(scan, FRAME_MS);
        };
        timer = setTimeout(scan, FRAME_MS);
      } catch (err) {
        if (stopped) return;
        setStatus("error");
        setMessage(cameraError(err));
      }
    }

    // Nothing the scanner does may break the rest of the page.
    start().catch(() => {
      if (stopped) return;
      setStatus("error");
      setMessage(cameraError(null));
    });
    return () => {
      stopped = true;
      clearTimeout(timer);
      if (stream) stopStream(stream);
    };
  }, []);

  return (
    <div className="flex flex-col gap-2">
      {status !== "error" && (
        <div className="relative aspect-square w-full max-w-sm overflow-hidden rounded-xl bg-ink">
          <video
            ref={video}
            playsInline
            muted
            autoPlay
            className="size-full object-cover"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-[18%] rounded-lg border-2 border-white/80"
          />
          {status === "starting" && (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
              Starting the camera…
            </p>
          )}
        </div>
      )}
      <p
        aria-live="polite"
        role={status === "error" ? "alert" : undefined}
        className={`min-h-5 text-sm ${status === "error" ? "text-meeple" : "text-ink/80"}`}
      >
        {message ??
          (status === "scanning" ? "Hold a QR code inside the square." : "")}
      </p>
    </div>
  );
}

type Decoder = (typeof import("jsqr"))["default"];

function readFrame(
  el: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  decode: Decoder,
): string | null {
  const { videoWidth: w, videoHeight: h } = el;
  if (el.readyState < el.HAVE_CURRENT_DATA || !w || !h) return null;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
  const { data, width, height } = ctx.getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return (
    decode(data, width, height, { inversionAttempts: "dontInvert" })?.data ||
    null
  );
}
