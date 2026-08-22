import { NextFunction, Request, Response } from "express";
import { CustomError } from "../utils/error.utils.js";
import { ZodError } from "zod";
import jwt from 'jsonwebtoken'
import { MulterError } from "multer";
import { logServerError } from "../utils/safe-logger.utils.js";

type ErrorResponse = {
  success: false;
  message: string;
};

const sendError = (res: Response, statusCode: number, message: string) =>
  res.status(statusCode).json({ success: false, message } satisfies ErrorResponse);

export const notFoundMiddleware = (_req: Request, res: Response) =>
  sendError(res, 404, "Route not found");

export const errorMiddleware = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  if (err instanceof ZodError) {
    return sendError(res, 400, err.issues.map((issue) => issue.message).join(", "));
  }

  if (err instanceof MulterError) {
    switch (err.code) {
      case "LIMIT_FILE_SIZE":
        return sendError(res, 413, "File is too large");
      case "LIMIT_FILE_COUNT":
        return sendError(res, 400, "Too many files uploaded");
      case "LIMIT_UNEXPECTED_FILE":
        return sendError(res, 400, "Unexpected file field or too many files");
      default:
        return sendError(res, 400, "Invalid multipart request");
    }
  }

  if (
    req.is("multipart/form-data")
    && err instanceof Error
    && ["Unexpected end of form", "Malformed part header"].includes(err.message)
  ) {
    return sendError(res, 400, "Invalid multipart request");
  }

  if (err instanceof jwt.TokenExpiredError || err instanceof jwt.JsonWebTokenError) {
    return sendError(res, 401, "Invalid or expired token");
  }

  if (err instanceof CustomError) {
    if (err.statusCode >= 500) {
      logServerError("Application request failed.", err);
    }
    return sendError(res, err.statusCode, err.message);
  }

  logServerError("Unexpected request failure.", err);
  return sendError(res, 500, "Internal server error");
};
