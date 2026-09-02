import { describe, expect, it, vi } from "vitest";

import type { RateLimitPolicy } from "../src/security/rate-limit.js";
import {
  createLocalSocketEventRateLimitProvider,
} from "../src/socket/local-socket-event-rate-limit.adapter.js";
import {
  createSocketEventRateLimitBucketIdentity,
  joinSocketEventRateLimitKeyParts,
} from "../src/socket/socket-event-rate-limit.port.js";
import {
  SOCKET_EVENT_LIMITS,
  SocketEventRateLimiter,
} from "../src/socket/socket-security.js";
import { createCapturingMetrics } from "./support/capturing-metrics.js";

const policy = (namespace: string, limit: number): RateLimitPolicy => ({
  namespace,
  limit,
  windowMs: 60_000,
});

describe("Socket rate-limit identity and policy characterization", () => {
  it("preserves the exact NUL-joined SHA-256 bucket identity", () => {
    expect(joinSocketEventRateLimitKeyParts(["user-a", "chat-a"]))
      .toBe("user-a\0chat-a");
    expect(createSocketEventRateLimitBucketIdentity(
      SOCKET_EVENT_LIMITS.messageActorBurst,
      ["user-a"],
    )).toBe("P25wBErlaQkdAaWgFa_j5sxECu3j4iQZjSLFO64wVLE");
    expect(createSocketEventRateLimitBucketIdentity(
      SOCKET_EVENT_LIMITS.messageChatBurst,
      ["user-a", "chat-a"],
    )).toBe("tthieyhPAcD6bhvWI7uDDqL6NTZJaPeUqpo4LnIWze4");
    expect(createSocketEventRateLimitBucketIdentity(
      SOCKET_EVENT_LIMITS.messageChatBurst,
      ["chat-a", "user-a"],
    )).not.toBe("tthieyhPAcD6bhvWI7uDDqL6NTZJaPeUqpo4LnIWze4");
  });

  it("freezes every Socket policy namespace, limit, and window", () => {
    expect(SOCKET_EVENT_LIMITS).toEqual({
      messageActorBurst: { namespace: "socket-message-actor-burst", limit: 30, windowMs: 10_000 },
      messageChatBurst: { namespace: "socket-message-chat-burst", limit: 8, windowMs: 5_000 },
      messageChatWindow: { namespace: "socket-message-chat-window", limit: 60, windowMs: 60_000 },
      typingActor: { namespace: "socket-typing-actor", limit: 40, windowMs: 10_000 },
      typingChat: { namespace: "socket-typing-chat", limit: 5, windowMs: 2_000 },
      seenActor: { namespace: "socket-seen-actor", limit: 60, windowMs: 10_000 },
      seenChat: { namespace: "socket-seen-chat", limit: 20, windowMs: 10_000 },
      mutationActor: { namespace: "socket-mutation-actor", limit: 60, windowMs: 60_000 },
      editMessage: { namespace: "socket-edit-message", limit: 10, windowMs: 60_000 },
      deleteMessage: { namespace: "socket-delete-message", limit: 5, windowMs: 60_000 },
      reactionMessage: { namespace: "socket-reaction-message", limit: 6, windowMs: 10_000 },
      voteMessage: { namespace: "socket-vote-message", limit: 6, windowMs: 10_000 },
      pinMessage: { namespace: "socket-pin-message", limit: 4, windowMs: 30_000 },
      callActor: { namespace: "socket-call-actor", limit: 20, windowMs: 60_000 },
      callInitiation: { namespace: "socket-call-initiation", limit: 3, windowMs: 60_000 },
      callState: { namespace: "socket-call-state", limit: 8, windowMs: 60_000 },
      iceActor: { namespace: "socket-ice-actor", limit: 300, windowMs: 10_000 },
      iceCall: { namespace: "socket-ice-call", limit: 120, windowMs: 10_000 },
      negotiationActor: { namespace: "socket-negotiation-actor", limit: 60, windowMs: 30_000 },
      negotiationCall: { namespace: "socket-negotiation-call", limit: 10, windowMs: 30_000 },
    });
  });
});

describe("async local Socket rate-limit provider", () => {
  it("wraps the unchanged synchronous Socket limiter in a Promise boundary", async () => {
    const engine = new SocketEventRateLimiter();
    const provider = createLocalSocketEventRateLimitProvider(engine);
    const oneRequest = policy("local-async", 1);

    expect(engine.consume(oneRequest, ["subject"])).toBe(true);
    const result = provider.consume(oneRequest, ["other-subject"]);
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBe(true);
    await expect(provider.consume(oneRequest, ["other-subject"])).resolves.toBe(false);
  });

  it("preserves the fixed window and does not slide it on an increment", async () => {
    let now = 1_000;
    const provider = createLocalSocketEventRateLimitProvider(
      new SocketEventRateLimiter(100, () => now),
    );
    const twoRequests: RateLimitPolicy = {
      namespace: "local-fixed-window",
      limit: 2,
      windowMs: 1_000,
    };

    await expect(provider.consume(twoRequests, ["subject"])).resolves.toBe(true);
    now = 1_500;
    await expect(provider.consume(twoRequests, ["subject"])).resolves.toBe(true);
    await expect(provider.consume(twoRequests, ["subject"])).resolves.toBe(false);
    now = 2_000;
    await expect(provider.consume(twoRequests, ["subject"])).resolves.toBe(true);
  });

  it("allows every policy and commits every bucket", async () => {
    const provider = createLocalSocketEventRateLimitProvider();
    const first = policy("local-all-first", 1);
    const second = policy("local-all-second", 1);

    await expect(provider.consumeAll([first, second], ["subject"])).resolves.toBe(true);
    await expect(provider.consume(first, ["subject"])).resolves.toBe(false);
    await expect(provider.consume(second, ["subject"])).resolves.toBe(false);
  });

  it("keeps an earlier bucket consumed when a later policy rejects", async () => {
    const provider = createLocalSocketEventRateLimitProvider();
    const first = policy("local-partial-first", 2);
    const rejecting = policy("local-partial-rejecting", 1);
    const skipped = policy("local-partial-skipped", 1);

    await provider.consume(rejecting, ["subject"]);
    await expect(provider.consumeAll([first, rejecting, skipped], ["subject"]))
      .resolves.toBe(false);
    await expect(provider.consume(first, ["subject"])).resolves.toBe(true);
    await expect(provider.consume(first, ["subject"])).resolves.toBe(false);
    await expect(provider.consume(rejecting, ["subject"])).resolves.toBe(false);
    await expect(provider.consume(skipped, ["subject"])).resolves.toBe(true);
  });

  it("does not touch later policies after the first rejection", async () => {
    const provider = createLocalSocketEventRateLimitProvider();
    const rejecting = policy("local-first-rejecting", 1);
    const skipped = policy("local-first-skipped", 1);

    await provider.consume(rejecting, ["subject"]);
    await expect(provider.consumeAll([rejecting, skipped], ["subject"]))
      .resolves.toBe(false);
    await expect(provider.consume(skipped, ["subject"])).resolves.toBe(true);
  });

  it("commits the first two policies when a third policy rejects", async () => {
    const provider = createLocalSocketEventRateLimitProvider();
    const first = policy("local-third-first", 1);
    const second = policy("local-third-second", 1);
    const third = policy("local-third-rejecting", 1);

    await provider.consume(third, ["subject"]);
    await expect(provider.consumeAll([first, second, third], ["subject"]))
      .resolves.toBe(false);
    await expect(provider.consume(first, ["subject"])).resolves.toBe(false);
    await expect(provider.consume(second, ["subject"])).resolves.toBe(false);
  });

  it("retains explicit clear-based test isolation", async () => {
    const provider = createLocalSocketEventRateLimitProvider();
    const oneRequest = policy("local-clear", 1);

    await provider.consume(oneRequest, ["subject"]);
    await expect(provider.consume(oneRequest, ["subject"])).resolves.toBe(false);
    provider.clear();
    await expect(provider.consume(oneRequest, ["subject"])).resolves.toBe(true);
  });

  it("records one local provider failure and preserves the original rejection", async () => {
    const engine = new SocketEventRateLimiter();
    const failure = new Error("private local limiter failure");
    vi.spyOn(engine, "consume").mockImplementationOnce(() => {
      throw failure;
    });
    const metrics = createCapturingMetrics();
    const provider = createLocalSocketEventRateLimitProvider(engine, metrics);

    await expect(provider.consume(policy("local-failure", 1), ["private-user-id"]))
      .rejects.toBe(failure);
    expect(metrics.socketRateLimitProviderFailures).toEqual(["local"]);
    expect(JSON.stringify(metrics)).not.toContain("private-user-id");
  });
});
