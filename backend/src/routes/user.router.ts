import { Router } from "express";
import { testEmailHandler, updateUser } from "../controllers/user.controller.js";
import { fileValidation } from "../middlewares/file-validation.middleware.js";
import { avatarUpload } from "../middlewares/multer.middleware.js";
import { verifyToken } from "../middlewares/verify-token.middleware.js";
import { avatarUploadRateLimit, testEmailRateLimit } from "../middlewares/rate-limit.middleware.js";
import { uploadCleanupBoundary } from "../utils/upload-lifecycle.util.js";

export default Router()

.patch("/",verifyToken,avatarUploadRateLimit,uploadCleanupBoundary,avatarUpload.single("avatar"),fileValidation,updateUser)
.post("/test-email",verifyToken,testEmailRateLimit,testEmailHandler)
