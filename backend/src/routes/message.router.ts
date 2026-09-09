import { Router } from "express";
import { verifyToken } from "../middlewares/verify-token.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { getMessageContext, getMessages } from "../controllers/message.controller.js";
import {
  messageContextParamsSchema,
  messageContextQuerySchema,
} from "../schemas/message.schema.js";

export default Router()

.get(
  "/:chatId/:messageId/context",
  verifyToken,
  validate(messageContextParamsSchema, "params"),
  validate(messageContextQuerySchema, "query"),
  getMessageContext,
)
.get("/:id",verifyToken,getMessages)
