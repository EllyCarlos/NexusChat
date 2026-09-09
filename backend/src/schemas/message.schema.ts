import { z } from "zod";

export const MAX_MESSAGE_CONTEXT_MESSAGES_PER_SIDE = 50;
export const DEFAULT_MESSAGE_CONTEXT_MESSAGES_PER_SIDE = 20;

const cuid = z.string().cuid();
const contextCount = z.string()
  .regex(/^(0|[1-9]\d*)$/, "Context limits must be non-negative integers")
  .transform(Number)
  .pipe(
    z.number()
      .int()
      .min(0)
      .max(
        MAX_MESSAGE_CONTEXT_MESSAGES_PER_SIDE,
        `Context limits cannot exceed ${MAX_MESSAGE_CONTEXT_MESSAGES_PER_SIDE}`,
      ),
  );

export const messageContextParamsSchema = z.object({
  chatId: cuid,
  messageId: cuid,
}).strict();

export const messageContextQuerySchema = z.object({
  before: contextCount.default(String(DEFAULT_MESSAGE_CONTEXT_MESSAGES_PER_SIDE)),
  after: contextCount.default(String(DEFAULT_MESSAGE_CONTEXT_MESSAGES_PER_SIDE)),
}).strict();

export type MessageContextParams = z.infer<typeof messageContextParamsSchema>;
export type MessageContextQuery = z.infer<typeof messageContextQuerySchema>;
