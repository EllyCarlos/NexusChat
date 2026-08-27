import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../../../config/env.config.js";

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

type OAuthStateCookiePayload = {
  state: string;
  expiresAt: number;
};

const OAUTH_STATE_SIGNATURE_CONTEXT = "nexuschat:oauth-state:v1";

const signPayload = (encodedPayload: string) =>
  createHmac("sha256", config.auth.jwtSecret)
    .update(`${OAUTH_STATE_SIGNATURE_CONTEXT}:${encodedPayload}`)
    .digest("base64url");

const timingSafeStringEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
};

export const createOAuthStateBinding = (now = Date.now()) => {
  const state = randomBytes(32).toString("base64url");
  const payload: OAuthStateCookiePayload = {
    state,
    expiresAt: now + OAUTH_STATE_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");

  return {
    state,
    cookieValue: `${encodedPayload}.${signPayload(encodedPayload)}`,
  };
};

export const verifyOAuthStateBinding = ({
  providedState,
  cookieValue,
  now = Date.now(),
}: {
  providedState: string | undefined;
  cookieValue: string | undefined;
  now?: number;
}) => {
  if (!providedState || !cookieValue) {
    return false;
  }

  const cookieParts = cookieValue.split(".");
  if (cookieParts.length !== 2) {
    return false;
  }

  const [encodedPayload, providedSignature] = cookieParts;
  if (
    !encodedPayload ||
    !providedSignature ||
    !timingSafeStringEqual(providedSignature, signPayload(encodedPayload))
  ) {
    return false;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<OAuthStateCookiePayload>;

    return (
      typeof payload.state === "string" &&
      payload.state.length > 0 &&
      typeof payload.expiresAt === "number" &&
      Number.isFinite(payload.expiresAt) &&
      payload.expiresAt > now &&
      timingSafeStringEqual(providedState, payload.state)
    );
  } catch {
    return false;
  }
};
