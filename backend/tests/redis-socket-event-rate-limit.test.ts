import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  RedisSocketEventRateLimitProvider,
  createRedisSocketEventRateLimitProvider,
} from "../src/infrastructure/redis/redis-socket-event-rate-limit.js";
import type { RedisScriptExecutor } from "../src/infrastructure/redis/redis-script-executor.js";
import {
  CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT,
  SOCKET_EVENT_RATE_LIMIT_REDIS_KEY_PREFIX,
} from "../src/infrastructure/redis/socket-event-rate-limit-script.js";
import type { RateLimitPolicy } from "../src/security/rate-limit.js";
import { createCapturingMetrics } from "./support/capturing-metrics.js";

const POLICY_A = {
  namespace: "socket-policy-a",
  limit: 3,
  windowMs: 10_000,
} satisfies RateLimitPolicy;

const POLICY_B = {
  namespace: "socket-policy-b",
  limit: 4,
  windowMs: 20_000,
} satisfies RateLimitPolicy;

const POLICY_C = {
  namespace: "socket-policy-c",
  limit: 5,
  windowMs: 30_000,
} satisfies RateLimitPolicy;

const KEY_PARTS = ["private-user-id", "private-chat-id"] as const;

const createHarness = (isReady = true) => {
  const evalMock = vi.fn<RedisScriptExecutor["eval"]>();
  const executor = {
    isReady,
    eval: evalMock,
  };
  const metrics = createCapturingMetrics();
  const provider = createRedisSocketEventRateLimitProvider({ executor, metrics });
  return { evalMock, executor, metrics, provider };
};

const decision = (allowed: boolean): string => JSON.stringify({ allowed });

describe("Redis Socket event rate-limit provider", () => {
  it("uses the exact legacy bucket digest under the versioned prefix with one EVAL", async () => {
    const { evalMock, provider } = createHarness();
    evalMock.mockResolvedValue(decision(true));
    const expectedDigest = createHash("sha256")
      .update(POLICY_A.namespace)
      .update("\0")
      .update(KEY_PARTS.join("\0"))
      .digest("base64url");

    await expect(provider.consume(POLICY_A, KEY_PARTS)).resolves.toBe(true);

    expect(evalMock).toHaveBeenCalledOnce();
    expect(evalMock).toHaveBeenCalledWith(
      CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT,
      {
        keys: [`${SOCKET_EVENT_RATE_LIMIT_REDIS_KEY_PREFIX}${expectedDigest}`],
        arguments: ["3", "10000"],
      },
    );
    const [{ keys }] = evalMock.mock.calls[0].slice(1);
    expect(keys[0]).not.toContain(KEY_PARTS[0]);
    expect(keys[0]).not.toContain(KEY_PARTS[1]);
  });

  it("decodes an explicit denied decision without a second Redis operation", async () => {
    const { evalMock, provider } = createHarness();
    evalMock.mockResolvedValue(decision(false));

    await expect(provider.consume(POLICY_A, KEY_PARTS)).resolves.toBe(false);
    expect(evalMock).toHaveBeenCalledOnce();
  });

  it.each([
    undefined,
    1,
    "not-json",
    "[]",
    "{}",
    JSON.stringify({ allowed: 1 }),
    JSON.stringify({ allowed: true, count: 1 }),
  ])("rejects a malformed strict JSON decision %#", async (response) => {
    const { evalMock, provider } = createHarness();
    evalMock.mockResolvedValue(response);

    await expect(provider.consume(POLICY_A, KEY_PARTS)).rejects.toThrow(
      "Invalid Redis Socket event rate-limit response.",
    );
    expect(evalMock).toHaveBeenCalledOnce();
  });

  it("propagates an executor failure without retry or fallback", async () => {
    const { evalMock, metrics, provider } = createHarness();
    const failure = new Error("obvious-fake-command-failure");
    evalMock.mockRejectedValue(failure);

    await expect(provider.consume(POLICY_A, KEY_PARTS)).rejects.toBe(failure);
    expect(evalMock).toHaveBeenCalledOnce();
    expect(metrics.socketRateLimitProviderFailures).toEqual(["redis"]);
    expect(JSON.stringify(metrics)).not.toContain(KEY_PARTS[0]);
    expect(JSON.stringify(metrics)).not.toContain(KEY_PARTS[1]);
  });

  it("fails closed before EVAL while the shared command executor is not ready", async () => {
    const { evalMock, metrics, provider } = createHarness(false);

    await expect(provider.consume(POLICY_A, KEY_PARTS)).rejects.toThrow(
      "Redis Socket event rate-limit executor is not ready.",
    );
    expect(evalMock).not.toHaveBeenCalled();
    expect(metrics.socketRateLimitProviderFailures).toEqual(["redis"]);
  });

  it.each([
    { ...POLICY_A, namespace: "" },
    { ...POLICY_A, namespace: "invalid\0namespace" },
    { ...POLICY_A, limit: 0 },
    { ...POLICY_A, limit: -1 },
    { ...POLICY_A, limit: 1.5 },
    { ...POLICY_A, limit: Number.MAX_SAFE_INTEGER + 1 },
    { ...POLICY_A, windowMs: 0 },
    { ...POLICY_A, windowMs: -1 },
    { ...POLICY_A, windowMs: 1.5 },
    { ...POLICY_A, windowMs: Number.MAX_SAFE_INTEGER + 1 },
  ])("rejects invalid policy values before EVAL: $namespace/$limit/$windowMs", async (policy) => {
    const { evalMock, provider } = createHarness();

    await expect(provider.consume(policy, KEY_PARTS)).rejects.toThrow(
      /^Invalid Socket event rate-limit /,
    );
    expect(evalMock).not.toHaveBeenCalled();
  });

  it("accepts a nonempty NUL-free namespace without changing its identity", async () => {
    const { evalMock, provider } = createHarness();
    evalMock.mockResolvedValue(decision(true));

    await expect(provider.consume({
      namespace: " ",
      limit: 1,
      windowMs: 1,
    }, KEY_PARTS)).resolves.toBe(true);
    expect(evalMock).toHaveBeenCalledOnce();
  });

  it("is constructible through both the class and factory boundaries", () => {
    const { executor, provider } = createHarness();

    expect(provider).toBeInstanceOf(RedisSocketEventRateLimitProvider);
    expect(new RedisSocketEventRateLimitProvider({ executor }))
      .toBeInstanceOf(RedisSocketEventRateLimitProvider);
  });
});

describe("Redis Socket event consumeAll sequencing", () => {
  it("returns true after consuming every allowed policy in order", async () => {
    const { evalMock, provider } = createHarness();
    evalMock.mockResolvedValueOnce(decision(true));
    evalMock.mockResolvedValueOnce(decision(true));

    await expect(provider.consumeAll([POLICY_A, POLICY_B], KEY_PARTS))
      .resolves.toBe(true);
    expect(evalMock).toHaveBeenCalledTimes(2);
    expect(evalMock.mock.calls.map(([, options]) => options.arguments))
      .toEqual([["3", "10000"], ["4", "20000"]]);
  });

  it("keeps the first consume committed when the second rejects", async () => {
    const { evalMock, provider } = createHarness();
    evalMock.mockResolvedValueOnce(decision(true));
    evalMock.mockResolvedValueOnce(decision(false));

    await expect(provider.consumeAll([POLICY_A, POLICY_B], KEY_PARTS))
      .resolves.toBe(false);
    expect(evalMock).toHaveBeenCalledTimes(2);
  });

  it("does not touch a later policy when the first rejects", async () => {
    const { evalMock, provider } = createHarness();
    evalMock.mockResolvedValueOnce(decision(false));

    await expect(provider.consumeAll([POLICY_A, POLICY_B], KEY_PARTS))
      .resolves.toBe(false);
    expect(evalMock).toHaveBeenCalledOnce();
  });

  it("keeps the first two consumes committed when a third policy rejects", async () => {
    const { evalMock, provider } = createHarness();
    evalMock.mockResolvedValueOnce(decision(true));
    evalMock.mockResolvedValueOnce(decision(true));
    evalMock.mockResolvedValueOnce(decision(false));

    await expect(provider.consumeAll(
      [POLICY_A, POLICY_B, POLICY_C],
      KEY_PARTS,
    )).resolves.toBe(false);
    expect(evalMock).toHaveBeenCalledTimes(3);
  });

  it("preserves the first consume when the second executor operation fails", async () => {
    const { evalMock, provider } = createHarness();
    const failure = new Error("obvious-fake-second-command-failure");
    evalMock.mockResolvedValueOnce(decision(true));
    evalMock.mockRejectedValueOnce(failure);

    await expect(provider.consumeAll([POLICY_A, POLICY_B], KEY_PARTS))
      .rejects.toBe(failure);
    expect(evalMock).toHaveBeenCalledTimes(2);
  });

  it("does not touch later policies when the first executor operation fails", async () => {
    const { evalMock, provider } = createHarness();
    const failure = new Error("obvious-fake-first-command-failure");
    evalMock.mockRejectedValueOnce(failure);

    await expect(provider.consumeAll([POLICY_A, POLICY_B], KEY_PARTS))
      .rejects.toBe(failure);
    expect(evalMock).toHaveBeenCalledOnce();
  });

  it("accepts an empty policy list without touching Redis", async () => {
    const { evalMock, provider } = createHarness(false);

    await expect(provider.consumeAll([], KEY_PARTS)).resolves.toBe(true);
    expect(evalMock).not.toHaveBeenCalled();
  });
});

describe("Socket event rate-limit Lua contract", () => {
  it("uses Redis TIME and one declared key with the exact argument indexes", () => {
    expect(CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT).toContain(
      "redis.call('TIME')",
    );
    expect(new Set(
      CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT.match(/KEYS\[\d+\]/g),
    )).toEqual(new Set(["KEYS[1]"]));
    expect(new Set(
      CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT.match(/ARGV\[\d+\]/g),
    )).toEqual(new Set(["ARGV[1]", "ARGV[2]"]));
  });

  it("creates one fixed expiry and never refreshes it after HINCRBY", () => {
    const expiryCalls = CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT
      .match(/redis\.call\('PEXPIREAT'/g);
    expect(expiryCalls).toHaveLength(1);
    expect(CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT).toContain(
      "redis.call('HSET', KEYS[1], 'count', 1, 'resetAt', reset_at)",
    );
    expect(CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT).toContain(
      "redis.call('HINCRBY', KEYS[1], 'count', 1)",
    );
    expect(CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT.indexOf("PEXPIREAT"))
      .toBeLessThan(CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT.indexOf("HINCRBY"));
    expect(CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT.slice(
      CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT.indexOf("HINCRBY"),
    )).not.toContain("PEXPIREAT");
  });

  it("validates policy, stored state, and TTL before incrementing", () => {
    expect(CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT).toContain("limit <= 0");
    expect(CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT).toContain("window_ms <= 0");
    expect(CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT).toContain(
      "redis.call('HMGET', KEYS[1], 'count', 'resetAt')",
    );
    expect(CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT).toContain(
      "ttl = redis.call('PTTL', KEYS[1])",
    );
    expect(CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT).toContain("ttl <= 0");
    expect(CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT).toContain(
      "redis.call('HLEN', KEYS[1]) ~= 2",
    );
    expect(CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT).toContain(
      "if count >= limit then",
    );
  });

  it("raises generic Redis errors for invalid policy/state and removes a failed first bucket", () => {
    expect(CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT).toContain(
      "redis.error_reply('INVALID_RATE_LIMIT_POLICY')",
    );
    expect(CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT).toContain(
      "redis.error_reply('INVALID_RATE_LIMIT_STATE')",
    );
    expect(CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT).toContain(
      "redis.call('DEL', KEYS[1])",
    );
    expect(CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT).not.toContain(
      "private-user-id",
    );
    expect(CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT).not.toContain(
      "private-chat-id",
    );
  });

  it("has balanced Lua block delimiters and strict JSON decisions", () => {
    const starts = CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT
      .split("\n")
      .filter(line => /^\s*(?:if\b|local function\b)/.test(line));
    const ends = CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT
      .split("\n")
      .filter(line => /^\s*end\s*$/.test(line));

    expect(ends).toHaveLength(starts.length);
    expect(CONSUME_SOCKET_EVENT_RATE_LIMIT_SCRIPT).toContain(
      "return cjson.encode({ allowed = allowed })",
    );
  });
});
