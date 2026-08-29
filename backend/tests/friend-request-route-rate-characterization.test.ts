import express, {
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRequestSchema: { marker: "create-request-schema" },
  handleRequestSchema: { marker: "handle-request-schema" },
  verifyToken: vi.fn((req: Request, res: Response, next: NextFunction) => {
    if (!req.get("authorization")) {
      res.status(401).json({ success: false, message: "Authentication is required" });
      return;
    }
    next();
  }),
  createRequestValidation: vi.fn(
    (_req: Request, _res: Response, next: NextFunction) => next(),
  ),
  handleRequestValidation: vi.fn(
    (_req: Request, _res: Response, next: NextFunction) => next(),
  ),
  getUserRequests: vi.fn((_req: Request, res: Response) => res.status(200).json([])),
  createRequest: vi.fn((_req: Request, res: Response) => res.status(201).json({})),
  handleRequest: vi.fn((_req: Request, res: Response) => res.status(200).json({ id: "request-1" })),
}));

vi.mock("../src/middlewares/verify-token.middleware.js", () => ({
  verifyToken: mocks.verifyToken,
}));

vi.mock("../src/middlewares/validate.middleware.js", () => ({
  validate: vi.fn((schema: unknown) => {
    if (schema === mocks.createRequestSchema) return mocks.createRequestValidation;
    if (schema === mocks.handleRequestSchema) return mocks.handleRequestValidation;
    throw new Error("Unexpected request schema");
  }),
}));

vi.mock("../src/schemas/request.schema.js", () => ({
  createRequestSchema: mocks.createRequestSchema,
  handleRequestSchema: mocks.handleRequestSchema,
}));

vi.mock("../src/controllers/request.controller.js", () => ({
  getUserRequests: mocks.getUserRequests,
  createRequest: mocks.createRequest,
  handleRequest: mocks.handleRequest,
}));

import {
  BACKEND_RATE_LIMITS,
  enforcePairRateLimit,
} from "../src/middlewares/rate-limit.middleware.js";
import requestRouter from "../src/routes/request.router.js";
import {
  clearBackendRateLimitsForTests,
  RATE_LIMIT_MESSAGE,
} from "../src/security/rate-limit.js";

type RouterLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
};

const routeLayers = () => (
  requestRouter as unknown as { stack: RouterLayer[] }
).stack.filter((layer): layer is Required<Pick<RouterLayer, "route">> => Boolean(layer.route));

const createRequestTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/request", requestRouter);
  return app;
};

const responseRecorder = () => ({
  setHeader: vi.fn(),
} as unknown as Response);

beforeEach(() => {
  vi.clearAllMocks();
  clearBackendRateLimitsForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("friend-request route boundary characterization", () => {
  it("keeps GET, POST, and DELETE methods and middleware in their current order", () => {
    const layers = routeLayers();

    expect(layers).toHaveLength(3);
    expect(layers.map(({ route }) => ({
      path: route.path,
      methods: Object.keys(route.methods),
    }))).toEqual([
      { path: "/", methods: ["get"] },
      { path: "/", methods: ["post"] },
      { path: "/:id", methods: ["delete"] },
    ]);
    expect(layers[0].route.stack.map(({ handle }) => handle)).toEqual([
      mocks.verifyToken,
      mocks.getUserRequests,
    ]);
    expect(layers[1].route.stack.map(({ handle }) => handle)).toEqual([
      mocks.verifyToken,
      mocks.createRequestValidation,
      mocks.createRequest,
    ]);
    expect(layers[2].route.stack.map(({ handle }) => handle)).toEqual([
      mocks.verifyToken,
      mocks.handleRequestValidation,
      mocks.handleRequest,
    ]);
  });

  it.each([
    ["GET", "/api/v1/request"],
    ["POST", "/api/v1/request"],
    ["DELETE", "/api/v1/request/request-1"],
  ] as const)("rejects unauthenticated %s before validation or controller work", async (method, path) => {
    const client = request(createRequestTestApp());
    const response = method === "GET"
      ? await client.get(path)
      : method === "POST"
        ? await client.post(path).send({ receiver: "receiver-1" })
        : await client.delete(path).send({ action: "accept" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: "Authentication is required",
    });
    expect(mocks.verifyToken).toHaveBeenCalledOnce();
    expect(mocks.createRequestValidation).not.toHaveBeenCalled();
    expect(mocks.handleRequestValidation).not.toHaveBeenCalled();
    expect(mocks.getUserRequests).not.toHaveBeenCalled();
    expect(mocks.createRequest).not.toHaveBeenCalled();
    expect(mocks.handleRequest).not.toHaveBeenCalled();
  });
});

describe("friend-request pair-rate characterization", () => {
  it("uses one symmetric pair key for sender/receiver and receiver/sender", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T12:00:00.000Z"));
    const response = responseRecorder();
    const next = vi.fn();

    expect(enforcePairRateLimit({
      response,
      next,
      actorUserId: "user-a",
      otherUserId: "user-b",
      policy: BACKEND_RATE_LIMITS.friendCreateCooldown,
      secondPolicy: BACKEND_RATE_LIMITS.friendCreateWindow,
    })).toBe(true);
    expect(enforcePairRateLimit({
      response,
      next,
      actorUserId: "user-b",
      otherUserId: "user-a",
      policy: BACKEND_RATE_LIMITS.friendCreateCooldown,
      secondPolicy: BACKEND_RATE_LIMITS.friendCreateWindow,
    })).toBe(false);

    expect(response.setHeader).toHaveBeenCalledOnce();
    expect(response.setHeader).toHaveBeenCalledWith("Retry-After", "30");
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 429,
      message: RATE_LIMIT_MESSAGE,
    }));
  });

  it("keeps create and handle buckets separate and consumes handle once per enforcement", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T12:00:00.000Z"));
    const response = responseRecorder();
    const next = vi.fn();

    expect(enforcePairRateLimit({
      response,
      next,
      actorUserId: "sender-user",
      otherUserId: "receiver-user",
      policy: BACKEND_RATE_LIMITS.friendCreateCooldown,
      secondPolicy: BACKEND_RATE_LIMITS.friendCreateWindow,
    })).toBe(true);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(enforcePairRateLimit({
        response,
        next,
        actorUserId: "receiver-user",
        otherUserId: "sender-user",
        policy: BACKEND_RATE_LIMITS.friendHandle,
      })).toBe(true);
    }
    expect(next).not.toHaveBeenCalled();

    expect(enforcePairRateLimit({
      response,
      next,
      actorUserId: "receiver-user",
      otherUserId: "sender-user",
      policy: BACKEND_RATE_LIMITS.friendHandle,
    })).toBe(false);
    expect(enforcePairRateLimit({
      response,
      next,
      actorUserId: "sender-user",
      otherUserId: "receiver-user",
      policy: BACKEND_RATE_LIMITS.friendHandle,
    })).toBe(false);

    expect(response.setHeader).toHaveBeenCalledTimes(2);
    expect(response.setHeader).toHaveBeenNthCalledWith(1, "Retry-After", "300");
    expect(response.setHeader).toHaveBeenNthCalledWith(2, "Retry-After", "300");
    expect(next).toHaveBeenCalledTimes(2);
    for (const [error] of next.mock.calls) {
      expect(error).toEqual(expect.objectContaining({
        statusCode: 429,
        message: RATE_LIMIT_MESSAGE,
      }));
    }
  });
});
