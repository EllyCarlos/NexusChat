import { z } from "zod";

export const MAX_SOCKET_TEXT_LENGTH = 64 * 1024;
export const MAX_SOCKET_AUDIO_BYTES = 900_000;
export const MAX_SOCKET_SDP_LENGTH = 64 * 1024;
export const MAX_SOCKET_ICE_CANDIDATE_LENGTH = 8 * 1024;

const cuid = z.string().cuid();
const boundedText = z.string().min(1).max(MAX_SOCKET_TEXT_LENGTH);
const audioBytes = z.instanceof(Uint8Array).refine(
  value => value.byteLength > 0 && value.byteLength <= MAX_SOCKET_AUDIO_BYTES,
);

const pollDataSchema = z.object({
  pollQuestion: z.string().min(1).max(500).optional(),
  pollOptions: z.array(z.string().min(1).max(200)).max(10).optional(),
  isMultipleAnswers: z.boolean().optional(),
}).strict();

export const messageEventSchema = z.object({
  chatId: cuid,
  isPollMessage: z.boolean(),
  textMessageContent: boundedText.optional(),
  encryptedAudio: audioBytes.optional(),
  audio: audioBytes.optional(),
  audioMimeType: z.literal("audio/webm").optional(),
  url: z.string().url().max(2_048).optional(),
  pollData: pollDataSchema.optional(),
  replyToMessageId: cuid.optional(),
}).strict().superRefine((payload, context) => {
  const contentCount = [
    payload.textMessageContent,
    payload.encryptedAudio,
    payload.audio,
    payload.url,
  ].filter(value => value !== undefined).length;

  if (payload.isPollMessage) {
    if (
      contentCount !== 0
      || !payload.pollData?.pollQuestion
      || !payload.pollData.pollOptions
      || payload.pollData.pollOptions.length < 2
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid poll message" });
    }
    return;
  }

  if (contentCount !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid message content" });
  }

  const hasAudio = payload.audio !== undefined || payload.encryptedAudio !== undefined;
  if (hasAudio !== (payload.audioMimeType === "audio/webm")) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid audio metadata" });
  }
});

export const messageSeenEventSchema = z.object({ chatId: cuid }).strict();
export const messageEditEventSchema = z.object({
  chatId: cuid,
  messageId: cuid,
  updatedTextContent: boundedText,
}).strict();
export const messageDeleteEventSchema = z.object({ chatId: cuid, messageId: cuid }).strict();
export const newReactionEventSchema = z.object({
  chatId: cuid,
  messageId: cuid,
  reaction: z.string().min(1).max(32),
}).strict();
export const deleteReactionEventSchema = messageDeleteEventSchema;
export const userTypingEventSchema = messageSeenEventSchema;
export const voteEventSchema = z.object({
  chatId: cuid,
  messageId: cuid,
  optionIndex: z.number().int().min(0).max(9),
}).strict();
export const pinMessageEventSchema = messageDeleteEventSchema;
export const unpinMessageEventSchema = z.object({ pinId: cuid }).strict();

const sessionDescription = (type: "offer" | "answer") => z.object({
  type: z.literal(type),
  sdp: z.string().min(1).max(MAX_SOCKET_SDP_LENGTH),
}).strict();

export const callUserEventSchema = z.object({
  calleeId: cuid,
  offer: sessionDescription("offer"),
}).strict();
export const callAcceptedEventSchema = z.object({
  callerId: cuid,
  answer: sessionDescription("answer"),
  callHistoryId: cuid,
}).strict();
export const callStateEventSchema = z.object({ callHistoryId: cuid }).strict();
export const iceCandidateEventSchema = z.object({
  candidate: z.object({
    candidate: z.string().min(1).max(MAX_SOCKET_ICE_CANDIDATE_LENGTH),
    sdpMid: z.string().max(256).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(65_535).nullable().optional(),
    usernameFragment: z.string().max(256).nullable().optional(),
  }),
  calleeId: cuid,
  callHistoryId: cuid,
}).strict();
export const negoNeededEventSchema = z.object({
  calleeId: cuid,
  offer: sessionDescription("offer"),
  callHistoryId: cuid,
}).strict();
export const negoDoneEventSchema = z.object({
  callerId: cuid,
  answer: sessionDescription("answer"),
  callHistoryId: cuid,
}).strict();

export type MessageEventReceivePayload = z.infer<typeof messageEventSchema>;
export type MessageSeenEventReceivePayload = z.infer<typeof messageSeenEventSchema>;
export type MessageEditEventReceivePayload = z.infer<typeof messageEditEventSchema>;
export type MessageDeleteEventReceivePayload = z.infer<typeof messageDeleteEventSchema>;
export type NewReactionEventReceivePayload = z.infer<typeof newReactionEventSchema>;
export type DeleteReactionEventReceivePayload = z.infer<typeof deleteReactionEventSchema>;
export type UserTypingEventReceivePayload = z.infer<typeof userTypingEventSchema>;
export type VoteEventReceivePayload = z.infer<typeof voteEventSchema>;
export type PinMessageEventReceivePayload = z.infer<typeof pinMessageEventSchema>;
export type UnpinMessageEventReceivePayload = z.infer<typeof unpinMessageEventSchema>;
export type CallUserEventReceivePayload = z.infer<typeof callUserEventSchema>;
export type CallAcceptedEventReceivePayload = z.infer<typeof callAcceptedEventSchema>;
export type CallStateEventReceivePayload = z.infer<typeof callStateEventSchema>;
export type IceCandidateEventReceivePayload = z.infer<typeof iceCandidateEventSchema>;
export type NegoNeededEventReceivePayload = z.infer<typeof negoNeededEventSchema>;
export type NegoDoneEventReceivePayload = z.infer<typeof negoDoneEventSchema>;
