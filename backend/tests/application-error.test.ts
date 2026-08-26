import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import {
  ApplicationError,
  LEGACY_CUSTOM_ERROR_CODE,
} from "../src/errors/application-error.js";
import {
  asyncErrorHandler,
  CustomError,
} from "../src/utils/error.utils.js";

describe("transport-neutral application errors", () => {
  it("retains a stable code, safe message, status metadata, and Error semantics", () => {
    const error = new ApplicationError({
      code: "CONFLICT",
      message: "The operation conflicts with current state",
      statusCode: 409,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ApplicationError);
    expect(error.name).toBe("ApplicationError");
    expect(error.code).toBe("CONFLICT");
    expect(error.message).toBe("The operation conflicts with current state");
    expect(error.statusCode).toBe(409);
  });

  it("keeps CustomError as an ApplicationError-compatible legacy bridge", () => {
    const error = new CustomError("Conflict is safe", 409);

    expect(error).toBeInstanceOf(ApplicationError);
    expect(error.name).toBe("CustomError");
    expect(error.code).toBe(LEGACY_CUSTOM_ERROR_CODE);
    expect(error.message).toBe("Conflict is safe");
    expect(error.statusCode).toBe(409);
  });
});

describe("async HTTP handler boundary", () => {
  it("forwards a rejected handler error exactly once", async () => {
    const error = new ApplicationError({
      code: "INTERNAL_ERROR",
      message: "Operation failed",
      statusCode: 500,
    });
    const next = vi.fn();
    const handler = asyncErrorHandler(async () => {
      throw error;
    });

    await handler({} as Request, {} as Response, next as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith(error);
  });
});
