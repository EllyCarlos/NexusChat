import { Router } from "express";
import { fetchAttachments, uploadAttachment } from "../controllers/attachment.controller.js";
import { attachmentUpload } from "../middlewares/multer.middleware.js";
import { verifyToken } from "../middlewares/verify-token.middleware.js";

export default Router()

.post("/",verifyToken,attachmentUpload.array("attachments[]",5),uploadAttachment)
.get("/:id",verifyToken,fetchAttachments)
