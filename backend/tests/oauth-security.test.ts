import express, { type NextFunction, type Request, type Response } from "express";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  providerMiddleware: vi.fn(),
  signOAuthExchangeToken: vi.fn(),
}));

vi.mock("passport", () => ({
  default: { authenticate: mocks.authenticate },
}));

vi.mock("../src/config/env.config.js", () => ({
  config: {
    app: {
      clientUrl: "https://web.example",
      environment: "test",
    },
    auth: { jwtSecret: "oauth-state-test-secret" },
  },
}));

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../src/modules/auth/token/session-token.service.js", () => ({
  signOAuthExchangeToken: mocks.signOAuthExchangeToken,
}));

import { redirectHandler } from "../src/controllers/auth.controller.js";
import {
  authenticateGoogleOAuthCallback,
  beginGoogleOAuth,
  OAUTH_STATE_COOKIE_NAME,
  validateGoogleOAuthState,
} from "../src/middlewares/oauth-state.middleware.js";
import { createHttpObservabilityMiddleware } from "../src/middlewares/http-observability.middleware.js";
import {
  createOAuthStateBinding,
  OAUTH_STATE_TTL_MS,
} from "../src/modules/auth/oauth/oauth-state.service.js";
import { createCapturingLogger } from "./support/capturing-logger.js";

const RAW_EXCHANGE_TOKEN = "raw.oauth.exchange.jwt";

const createResponse = () => {
  const response = {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
    redirect: vi.fn(),
  };
  response.redirect.mockReturnValue(response);
  return response;
};

const captureStructuredHttpOutput = async (requestPath: string) => {
  const logger = createCapturingLogger("application");
  const app = express();
  app.use(createHttpObservabilityMiddleware({ logger }));
  app.use((_req, res) => res.status(204).end());

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
  });

  try {
    const address = server.address() as AddressInfo;
    await fetch(`http://127.0.0.1:${address.port}${requestPath}`);
    return JSON.stringify(logger.events);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
};

describe("OAuth state boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockReturnValue(mocks.providerMiddleware);
    mocks.signOAuthExchangeToken.mockReturnValue(RAW_EXCHANGE_TOKEN);
  });

  it("generates a 256-bit state and binds it to a hardened backend cookie", () => {
    const response = createResponse();

    beginGoogleOAuth(
      {} as Request,
      response as unknown as Response,
      vi.fn() as NextFunction,
    );

    const authenticateOptions = mocks.authenticate.mock.calls[0]?.[1];
    expect(authenticateOptions.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.cookie).toHaveBeenCalledWith(
      OAUTH_STATE_COOKIE_NAME,
      expect.any(String),
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        maxAge: OAUTH_STATE_TTL_MS,
        path: "/api/v1/auth/google",
      }),
    );
    expect(mocks.providerMiddleware).toHaveBeenCalledTimes(1);
  });

  it("produces a different state for every OAuth start", () => {
    beginGoogleOAuth(
      {} as Request,
      createResponse() as unknown as Response,
      vi.fn() as NextFunction,
    );
    beginGoogleOAuth(
      {} as Request,
      createResponse() as unknown as Response,
      vi.fn() as NextFunction,
    );

    const firstState = mocks.authenticate.mock.calls[0]?.[1].state;
    const secondState = mocks.authenticate.mock.calls[1]?.[1].state;
    expect(firstState).not.toBe(secondState);
  });

  it("rejects a callback without state before the provider runs", () => {
    const binding = createOAuthStateBinding();
    const response = createResponse();
    const next = vi.fn();

    validateGoogleOAuthState(
      { cookies: { [OAUTH_STATE_COOKIE_NAME]: binding.cookieValue }, query: {} } as Request,
      response as unknown as Response,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(response.redirect).toHaveBeenCalledWith(
      303,
      "https://web.example/auth/oauth-redirect?error=oauth_state_invalid",
    );
  });

  it("rejects a callback with mismatched state", () => {
    const binding = createOAuthStateBinding();
    const response = createResponse();
    const next = vi.fn();

    validateGoogleOAuthState(
      {
        cookies: { [OAUTH_STATE_COOKIE_NAME]: binding.cookieValue },
        query: { state: "attacker-state" },
      } as unknown as Request,
      response as unknown as Response,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(response.clearCookie).toHaveBeenCalledWith(
      OAUTH_STATE_COOKIE_NAME,
      expect.objectContaining({ httpOnly: true, sameSite: "lax" }),
    );
  });

  it("rejects a caller-supplied state paired with an unsigned cookie", () => {
    const forgedState = "caller-controlled-state";
    const forgedPayload = Buffer.from(JSON.stringify({
      state: forgedState,
      expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
    })).toString("base64url");
    const response = createResponse();
    const next = vi.fn();

    validateGoogleOAuthState(
      {
        cookies: {
          [OAUTH_STATE_COOKIE_NAME]: `${forgedPayload}.invalid-signature`,
        },
        query: { state: forgedState },
      } as unknown as Request,
      response as unknown as Response,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(response.redirect).toHaveBeenCalledWith(
      303,
      "https://web.example/auth/oauth-redirect?error=oauth_state_invalid",
    );
  });

  it("rejects an expired state binding", () => {
    const binding = createOAuthStateBinding(Date.now() - OAUTH_STATE_TTL_MS - 1);
    const response = createResponse();
    const next = vi.fn();

    validateGoogleOAuthState(
      {
        cookies: { [OAUTH_STATE_COOKIE_NAME]: binding.cookieValue },
        query: { state: binding.state },
      } as unknown as Request,
      response as unknown as Response,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(response.redirect).toHaveBeenCalledWith(
      303,
      "https://web.example/auth/oauth-redirect?error=oauth_state_invalid",
    );
  });

  it("allows correct state into the mocked Passport/provider callback and consumes it", () => {
    const binding = createOAuthStateBinding();
    const response = createResponse();
    const mockedProviderCallback = vi.fn();

    validateGoogleOAuthState(
      {
        cookies: { [OAUTH_STATE_COOKIE_NAME]: binding.cookieValue },
        query: { state: binding.state },
      } as unknown as Request,
      response as unknown as Response,
      mockedProviderCallback,
    );

    expect(mockedProviderCallback).toHaveBeenCalledTimes(1);
    expect(response.clearCookie).toHaveBeenCalledWith(
      OAUTH_STATE_COOKIE_NAME,
      expect.objectContaining({ path: "/api/v1/auth/google" }),
    );
    expect(response.redirect).not.toHaveBeenCalled();
  });

  it("accepts the mocked provider user after state validation", () => {
    const providerUser = { id: "oauth-user" };
    mocks.authenticate.mockImplementationOnce(
      (_strategy, _options, callback) =>
        (_req: Request, _res: Response, _next: NextFunction) =>
          callback(null, providerUser),
    );
    const request = {} as Request;
    const response = createResponse();
    const next = vi.fn();

    authenticateGoogleOAuthCallback(
      request,
      response as unknown as Response,
      next,
    );

    expect(request.user).toBe(providerUser);
    expect(next).toHaveBeenCalledTimes(1);
    expect(response.redirect).not.toHaveBeenCalled();
  });

  it("normalizes a raw Passport/provider error to a static redirect", () => {
    const rawProviderError = "raw-provider-error-detail";
    mocks.authenticate.mockImplementationOnce(
      (_strategy, _options, callback) =>
        (_req: Request, _res: Response, _next: NextFunction) =>
          callback(new Error(rawProviderError), false),
    );
    const response = createResponse();
    const next = vi.fn();
    const logger = createCapturingLogger("auth");

    try {
      authenticateGoogleOAuthCallback(
        { app: { get: () => logger } } as unknown as Request,
        response as unknown as Response,
        next,
      );

      expect(next).not.toHaveBeenCalled();
      expect(response.redirect).toHaveBeenCalledWith(
        303,
        "https://web.example/auth/oauth-redirect?error=oauth_provider_failed",
      );
      expect(JSON.stringify(logger.events)).not.toContain(rawProviderError);
      expect(logger.events.at(-1)).toMatchObject({
        event: "auth.oauth_provider.failed",
        fields: { errorType: "Error" },
      });
    } finally {
      logger.reset();
    }
  });

  it("rejects replay after the state cookie has been consumed", () => {
    const binding = createOAuthStateBinding();
    const firstResponse = createResponse();
    const firstProviderCallback = vi.fn();

    validateGoogleOAuthState(
      {
        cookies: { [OAUTH_STATE_COOKIE_NAME]: binding.cookieValue },
        query: { state: binding.state },
      } as unknown as Request,
      firstResponse as unknown as Response,
      firstProviderCallback,
    );

    const replayResponse = createResponse();
    const replayProviderCallback = vi.fn();
    validateGoogleOAuthState(
      { cookies: {}, query: { state: binding.state } } as unknown as Request,
      replayResponse as unknown as Response,
      replayProviderCallback,
    );

    expect(firstProviderCallback).toHaveBeenCalledTimes(1);
    expect(replayProviderCallback).not.toHaveBeenCalled();
    expect(replayResponse.redirect).toHaveBeenCalledWith(
      303,
      "https://web.example/auth/oauth-redirect?error=oauth_state_invalid",
    );
  });

  it("normalizes provider/profile failures to the static OAuth failure route", () => {
    const middlewareSource = readFileSync(
      new URL("../src/middlewares/oauth-state.middleware.ts", import.meta.url),
      "utf8",
    );
    const strategySource = readFileSync(
      new URL("../src/passport/google.strategy.ts", import.meta.url),
      "utf8",
    );

    expect(middlewareSource).toContain("oauth_provider_failed");
    expect(strategySource).toContain("done(null, false)");
    expect(strategySource).not.toContain("console.log(error)");
  });
});

describe("OAuth-sensitive logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signOAuthExchangeToken.mockReturnValue(RAW_EXCHANGE_TOKEN);
  });

  it("does not write the raw exchange JWT to backend operational logs", async () => {
    const response = createResponse();
    const next = vi.fn();
    const logger = createCapturingLogger("auth");

    try {
      await redirectHandler(
        {
          user: {
            id: "oauth-user",
            email: "oauth@example.com",
            newUser: false,
          },
          app: { get: () => logger },
        } as unknown as Request,
        response as unknown as Response,
        next,
      );

      const loggedOutput = JSON.stringify(logger.events);
      expect(loggedOutput).toContain("auth.oauth_redirect.completed");
      expect(loggedOutput).not.toContain(RAW_EXCHANGE_TOKEN);
      expect(response.redirect).toHaveBeenCalledWith(
        307,
        `https://web.example/auth/oauth-redirect#token=${encodeURIComponent(RAW_EXCHANGE_TOKEN)}`,
      );
    } finally {
      logger.reset();
    }
  });

  it("omits the Google authorization code from structured HTTP output", async () => {
    const output = await captureStructuredHttpOutput(
      "/api/v1/auth/google/callback?code=google-secret-code",
    );

    expect(output).toContain("http.request.completed");
    expect(output).not.toContain("google-secret-code");
    expect(output).not.toContain("code=");
  });

  it("omits OAuth state from structured HTTP output", async () => {
    const output = await captureStructuredHttpOutput(
      "/api/v1/auth/google/callback?state=raw-oauth-state",
    );

    expect(output).toContain("http.request.completed");
    expect(output).not.toContain("raw-oauth-state");
    expect(output).not.toContain("state=");
  });

  it("automatically omits other sensitive query tokens from structured HTTP output", async () => {
    const output = await captureStructuredHttpOutput(
      "/api/v1/auth/recovery?token=raw-recovery-token",
    );

    expect(output).toContain("http.request.completed");
    expect(output).not.toContain("raw-recovery-token");
    expect(output).not.toContain("token=");
  });
});
