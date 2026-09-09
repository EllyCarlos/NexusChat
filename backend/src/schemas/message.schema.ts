import { z } from "zod";

export const MAX_MESSAGE_CONTEXT_MESSAGES_PER_SIDE = 50;
export const DEFAULT_MESSAGE_CONTEXT_MESSAGES_PER_SIDE = 20;
export const MIN_MESSAGE_SEARCH_QUERY_LENGTH = 2;
export const MAX_MESSAGE_SEARCH_QUERY_LENGTH = 100;
export const DEFAULT_MESSAGE_SEARCH_LIMIT = 20;
export const MAX_MESSAGE_SEARCH_LIMIT = 20;
export const MAX_MESSAGE_SEARCH_CURSOR_LENGTH = 512;

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
const searchLimit = z.string()
  .regex(/^[1-9]\d*$/, "Search limit must be a positive integer")
  .transform(Number)
  .pipe(
    z.number()
      .int()
      .min(1)
      .max(MAX_MESSAGE_SEARCH_LIMIT, `Search limit cannot exceed ${MAX_MESSAGE_SEARCH_LIMIT}`),
  );

export const messageContextParamsSchema = z.object({
  chatId: cuid,
  messageId: cuid,
}).strict();

export const messageContextQuerySchema = z.object({
  before: contextCount.default(String(DEFAULT_MESSAGE_CONTEXT_MESSAGES_PER_SIDE)),
  after: contextCount.default(String(DEFAULT_MESSAGE_CONTEXT_MESSAGES_PER_SIDE)),
}).strict();

export const messageSearchParamsSchema = z.object({
  chatId: cuid,
}).strict();

export const messageSearchQuerySchema = z.object({
  q: z.string()
    .trim()
    .min(
      MIN_MESSAGE_SEARCH_QUERY_LENGTH,
      `Search query must contain at least ${MIN_MESSAGE_SEARCH_QUERY_LENGTH} characters`,
    )
    .max(
      MAX_MESSAGE_SEARCH_QUERY_LENGTH,
      `Search query cannot exceed ${MAX_MESSAGE_SEARCH_QUERY_LENGTH} characters`,
    ),
  limit: searchLimit.default(String(DEFAULT_MESSAGE_SEARCH_LIMIT)),
  cursor: z.string()
    .min(1, "Search cursor cannot be empty")
    .max(
      MAX_MESSAGE_SEARCH_CURSOR_LENGTH,
      `Search cursor cannot exceed ${MAX_MESSAGE_SEARCH_CURSOR_LENGTH} characters`,
    )
    .optional(),
}).strict();

export type MessageContextParams = z.infer<typeof messageContextParamsSchema>;
export type MessageContextQuery = z.infer<typeof messageContextQuerySchema>;
export type MessageSearchParams = z.infer<typeof messageSearchParamsSchema>;
export type MessageSearchQuery = z.infer<typeof messageSearchQuerySchema>;
