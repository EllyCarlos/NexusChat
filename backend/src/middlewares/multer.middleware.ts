import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RequestHandler } from "express";
import multer from "multer";
import {
  ACCEPTED_FILE_MIME_TYPES,
  ACCEPTED_IMAGE_TYPES,
  MAX_FILE_SIZE,
} from "../constants/file.constant.js";
import { CustomError } from "../utils/error.utils.js";
import {
  cleanupRequestTemporaryFiles,
  trackTemporaryUploadPath,
} from "../utils/upload-lifecycle.util.js";

const COMMON_LIMITS = {
  fileSize: MAX_FILE_SIZE,
  fieldNameSize: 100,
  fieldSize: 64 * 1024,
  headerPairs: 20,
} as const;

export const resolveUploadTempDirectory = (): string =>
  process.env.NEXUSCHAT_UPLOAD_TEMP_DIR || join(tmpdir(), "nexuschat-uploads");

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    const uploadDirectory = resolveUploadTempDirectory();
    mkdirSync(uploadDirectory, { recursive: true });
    callback(null, uploadDirectory);
  },
  filename: (request, _file, callback) => {
    const filename = randomUUID();
    trackTemporaryUploadPath(request, join(resolveUploadTempDirectory(), filename));
    callback(null, filename);
  },
});

const claimedTypeFilter = (
  acceptedTypes: readonly string[],
): NonNullable<multer.Options["fileFilter"]> => (_request, file, callback) => {
  if (!acceptedTypes.includes(file.mimetype)) {
    callback(new CustomError("Unsupported or invalid file type", 400));
    return;
  }
  callback(null, true);
};

const cleanupOnMulterError = (middleware: RequestHandler): RequestHandler =>
  (request, response, next) => middleware(request, response, (error?: unknown) => {
    if (!error) {
      next();
      return;
    }
    void cleanupRequestTemporaryFiles(request).then(() => next(error));
  });

const avatarMulter = multer({
  storage,
  fileFilter: claimedTypeFilter(ACCEPTED_IMAGE_TYPES),
  limits: { ...COMMON_LIMITS, files: 1, fields: 0, parts: 2 },
});

const createChatMulter = multer({
  storage,
  fileFilter: claimedTypeFilter(ACCEPTED_IMAGE_TYPES),
  limits: { ...COMMON_LIMITS, files: 1, fields: 100, parts: 102 },
});

const groupChatMulter = multer({
  storage,
  fileFilter: claimedTypeFilter(ACCEPTED_IMAGE_TYPES),
  limits: { ...COMMON_LIMITS, files: 1, fields: 1, parts: 3 },
});

const attachmentMulter = multer({
  storage,
  fileFilter: claimedTypeFilter(ACCEPTED_FILE_MIME_TYPES),
  limits: { ...COMMON_LIMITS, files: 5, fields: 0, parts: 6 },
});

export const avatarUpload = {
  single: (fieldName: string): RequestHandler => cleanupOnMulterError(avatarMulter.single(fieldName)),
};

export const createChatUpload = {
  single: (fieldName: string): RequestHandler => cleanupOnMulterError(createChatMulter.single(fieldName)),
};

export const groupChatUpload = {
  single: (fieldName: string): RequestHandler => cleanupOnMulterError(groupChatMulter.single(fieldName)),
};

export const attachmentUpload = {
  array: (fieldName: string, maxCount: number): RequestHandler =>
    cleanupOnMulterError(attachmentMulter.array(fieldName, maxCount)),
};
