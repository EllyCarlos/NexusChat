import type { Request, RequestHandler } from "express";
import { unlink } from "node:fs/promises";
import { logServerError } from "./safe-logger.utils.js";

const trackedUploadPaths: unique symbol = Symbol("trackedUploadPaths");
type RequestWithTrackedUploads = Request & { [trackedUploadPaths]?: Set<string> };

const requestFiles = (request: Request): Express.Multer.File[] => {
  const files = request.files;
  const multipleFiles = Array.isArray(files)
    ? files
    : files
      ? Object.values(files).flat()
      : [];

  return request.file ? [request.file, ...multipleFiles] : multipleFiles;
};

const cleanupTemporaryPaths = async (paths: string[]): Promise<void> => {
  const results = await Promise.allSettled(paths.map((path) => unlink(path)));

  for (const result of results) {
    if (result.status === "rejected") {
      const error = result.reason as NodeJS.ErrnoException;
      if (error?.code !== "ENOENT") {
        logServerError("Temporary upload cleanup failed.", error);
      }
    }
  }
};

export const cleanupTemporaryFiles = async (files: Express.Multer.File[]): Promise<void> =>
  cleanupTemporaryPaths([...new Set(files.map((file) => file.path).filter(Boolean))]);

export const trackTemporaryUploadPath = (request: Request, path: string): void => {
  const trackedRequest = request as RequestWithTrackedUploads;
  trackedRequest[trackedUploadPaths] ??= new Set();
  trackedRequest[trackedUploadPaths]?.add(path);
};

export const cleanupRequestTemporaryFiles = async (request: Request): Promise<void> => {
  const trackedPaths = [...((request as RequestWithTrackedUploads)[trackedUploadPaths] ?? [])];
  const filePaths = requestFiles(request).map((file) => file.path).filter(Boolean);
  await cleanupTemporaryPaths([...new Set([...trackedPaths, ...filePaths])]);
};

export const uploadCleanupBoundary: RequestHandler = (request, response, next) => {
  let cleanupStarted = false;
  const cleanup = () => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    void cleanupRequestTemporaryFiles(request);
  };

  response.once("finish", cleanup);
  response.once("close", cleanup);
  next();
};
