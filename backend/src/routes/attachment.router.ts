import { Router } from "express";
import { fetchAttachments, uploadAttachment } from "../controllers/attachment.controller.js";
import { attachmentFileValidation } from "../middlewares/file-validation.middleware.js";
import { attachmentUpload } from "../middlewares/multer.middleware.js";
import { verifyToken } from "../middlewares/verify-token.middleware.js";
import { attachmentUploadRateLimit } from "../middlewares/rate-limit.middleware.js";
import { authorizeAttachmentUpload } from "../middlewares/upload-authorization.middleware.js";
import { uploadCleanupBoundary } from "../utils/upload-lifecycle.util.js";

export default Router()

.post("/:chatId",verifyToken,attachmentUploadRateLimit,authorizeAttachmentUpload,uploadCleanupBoundary,attachmentUpload.array("attachments[]",5),attachmentFileValidation,uploadAttachment)
.get("/:id",verifyToken,fetchAttachments)
