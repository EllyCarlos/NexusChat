import type { NextFunction, Request, Response } from "express";
import { fileTypeFromFile } from "file-type";
import { CustomError } from "../utils/error.utils.js";
import { cleanupRequestTemporaryFiles } from "../utils/upload-lifecycle.util.js";

const INVALID_FILE_MESSAGE = "Unsupported or invalid file type";
const AVATAR_MIME_TYPES = new Set(["image/jpeg", "image/png"]);
const ATTACHMENT_MIME_TYPES = new Set([...AVATAR_MIME_TYPES, "application/pdf"]);

const normalizedClaimedMime = (mime: string): string =>
  mime === "image/jpg" ? "image/jpeg" : mime;

const validateFiles = (
  getFiles: (request: Request) => Express.Multer.File[],
  acceptedDetectedMimes: ReadonlySet<string>,
) => async (request: Request, _response: Response, next: NextFunction) => {
  const files = getFiles(request);
  try {
    for (const file of files) {
      const detected = await fileTypeFromFile(file.path);
      if (
        !detected
        || !acceptedDetectedMimes.has(detected.mime)
        || normalizedClaimedMime(file.mimetype) !== detected.mime
      ) {
        await cleanupRequestTemporaryFiles(request);
        next(new CustomError(INVALID_FILE_MESSAGE, 400));
        return;
      }
    }
    next();
  } catch {
    await cleanupRequestTemporaryFiles(request);
    next(new CustomError(INVALID_FILE_MESSAGE, 400));
  }
};

export const fileValidation = validateFiles(
  (request) => request.file ? [request.file] : [],
  AVATAR_MIME_TYPES,
);

export const attachmentFileValidation = validateFiles(
  (request) => Array.isArray(request.files) ? request.files : [],
  ATTACHMENT_MIME_TYPES,
);
