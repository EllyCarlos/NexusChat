import { Router } from "express";
import { validate } from "../middlewares/validate.middleware.js";
import { createChatSchema, addMemberToChatSchema, removeMemberfromChat, updateChatSchema } from "../schemas/chat.schema.js";
import { addMemberToChat, createChat, getUserChats, removeMemberFromChat, updateChat } from "../controllers/chat.controller.js";
import { verifyToken } from "../middlewares/verify-token.middleware.js";
import { createChatUpload, groupChatUpload } from "../middlewares/multer.middleware.js";
import { avatarUploadRateLimit } from "../middlewares/rate-limit.middleware.js";
import { fileValidation } from "../middlewares/file-validation.middleware.js";
import { authorizeGroupChatUpload } from "../middlewares/upload-authorization.middleware.js";
import { uploadCleanupBoundary } from "../utils/upload-lifecycle.util.js";


export default Router()

.post("/",verifyToken,avatarUploadRateLimit,uploadCleanupBoundary,createChatUpload.single("avatar"),fileValidation,validate(createChatSchema),createChat)
.get("/",verifyToken,getUserChats)
.patch("/:id/members",verifyToken,validate(addMemberToChatSchema),addMemberToChat)
.patch("/:id",verifyToken,avatarUploadRateLimit,authorizeGroupChatUpload,uploadCleanupBoundary,groupChatUpload.single('avatar'),fileValidation,validate(updateChatSchema),updateChat)
.delete("/:id/members",verifyToken,validate(removeMemberfromChat),removeMemberFromChat)
