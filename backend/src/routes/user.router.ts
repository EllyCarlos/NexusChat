import { Router } from "express";
import { testEmailHandler, updateUser } from "../controllers/user.controller.js";
import { fileValidation } from "../middlewares/file-validation.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";
import { verifyToken } from "../middlewares/verify-token.middleware.js";
import { avatarUploadRateLimit, testEmailRateLimit } from "../middlewares/rate-limit.middleware.js";

export default Router()

.patch("/",verifyToken,avatarUploadRateLimit,upload.single("avatar"),fileValidation,updateUser)
.post("/test-email",verifyToken,testEmailRateLimit,testEmailHandler)
