import { Router } from "express";
import { verifyToken } from "../middlewares/verify-token.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { messageSearchRateLimit } from "../middlewares/rate-limit.middleware.js";
import {
  getMessageContext,
  getMessages,
  searchGroupMessages,
} from "../controllers/message.controller.js";
import {
  messageContextParamsSchema,
  messageContextQuerySchema,
  messageSearchParamsSchema,
  messageSearchQuerySchema,
} from "../schemas/message.schema.js";

export default Router()

.get(
  "/:chatId/:messageId/context",
  verifyToken,
  validate(messageContextParamsSchema, "params"),
  validate(messageContextQuerySchema, "query"),
  getMessageContext,
)
.get(
  "/:chatId/search",
  verifyToken,
  messageSearchRateLimit,
  validate(messageSearchParamsSchema, "params"),
  validate(messageSearchQuerySchema, "query"),
  searchGroupMessages,
)
.get("/:id",verifyToken,getMessages)
