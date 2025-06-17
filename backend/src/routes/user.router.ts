import { Router } from "express";
import { testEmailHandler, udpateUser } from "../controllers/user.controller.js";
import { fileValidation } from "../middlewares/file-validation.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";
import { verifyToken } from "../middlewares/verify-token.middleware.js";

export default Router()

.patch("/",verifyToken,upload.single("avatar"),fileValidation,udpateUser)
.get("/test-email",verifyToken,testEmailHandler)