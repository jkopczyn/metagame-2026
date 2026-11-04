import { getAuth } from "@/lib/auth";
import {
  beginLoginAttempt,
  clientIp,
  MAX_EMAIL_LENGTH,
} from "@/lib/login-throttle";

// The app reaches Better Auth through auth.api.*, which doesn't come through
// this route. The one HTTP caller is scripts/preview-shot.mjs, so everything
// else stays unserved rather than exposing each plugin's endpoints.
const SIGN_IN = "/api/auth/sign-in/email";

async function emailIn(request: Request): Promise<string | null> {
  const body: unknown = await request
    .clone()
    .json()
    .catch(() => null);
  const email = (body as { email?: unknown } | null)?.email;
  if (typeof email !== "string" || email.length > MAX_EMAIL_LENGTH) return null;
  return email.trim().toLowerCase();
}

// By code, not status: Better Auth also answers 401 when a right password
// can't get a session.
async function rejectedPassword(response: Response): Promise<boolean> {
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  return (
    (body as { code?: unknown } | null)?.code === "INVALID_EMAIL_OR_PASSWORD"
  );
}

export async function POST(request: Request) {
  if (new URL(request.url).pathname !== SIGN_IN) {
    return new Response("Not Found", { status: 404 });
  }
  const email = await emailIn(request);
  if (!email) {
    return Response.json(
      { code: "INVALID_EMAIL", message: "Send an email and a password." },
      { status: 400 },
    );
  }
  const attempt = await beginLoginAttempt(
    "password",
    email,
    clientIp(request.headers),
  );
  if (!attempt) {
    return Response.json(
      { code: "TOO_MANY_ATTEMPTS", message: "Too many tries." },
      { status: 429 },
    );
  }
  let response: Response;
  try {
    response = await getAuth().handler(request);
  } catch (e) {
    await attempt.release();
    throw e;
  }
  if (response.ok) await attempt.succeeded();
  else if (!(await rejectedPassword(response))) await attempt.release();
  return response;
}
