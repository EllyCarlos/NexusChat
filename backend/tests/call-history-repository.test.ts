import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callHistoryCreate: vi.fn(),
  callHistoryUpdate: vi.fn(),
}));

vi.mock("../src/lib/prisma.lib.js", () => ({
  prisma: {
    callHistory: {
      create: mocks.callHistoryCreate,
      update: mocks.callHistoryUpdate,
    },
  },
}));

import { prisma } from "../src/lib/prisma.lib.js";
import {
  createPrismaCallHistoryRepository,
  prismaCallHistoryRepository,
} from "../src/modules/calls/infrastructure/prisma-call-history.repository.js";

const repository = createPrismaCallHistoryRepository(prisma);

const CALLER_ID = "caller-user";
const CALLEE_ID = "callee-user";
const CALL_HISTORY_ID = "call-history-1";

describe("Prisma call-history repository", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("exports a composed singleton and requires no transaction surface", () => {
    expect(prismaCallHistoryRepository).toBeDefined();
    expect(prisma).not.toHaveProperty("$transaction");
  });

  it("creates a ringing call with only the caller and callee fields", async () => {
    const createdCall = { id: CALL_HISTORY_ID };
    mocks.callHistoryCreate.mockResolvedValueOnce(createdCall);

    await expect(repository.create({
      kind: "ringing",
      callerId: CALLER_ID,
      calleeId: CALLEE_ID,
    })).resolves.toBe(createdCall);

    expect(mocks.callHistoryCreate).toHaveBeenCalledOnce();
    expect(mocks.callHistoryCreate).toHaveBeenCalledWith({
      data: {
        callerId: CALLER_ID,
        calleeId: CALLEE_ID,
      },
    });
    expect(mocks.callHistoryUpdate).not.toHaveBeenCalled();
  });

  it("creates a missed call with the exact terminal persistence fields", async () => {
    const endedAt = new Date("2025-01-01T00:00:00.000Z");
    const createdCall = { id: CALL_HISTORY_ID };
    mocks.callHistoryCreate.mockResolvedValueOnce(createdCall);

    await expect(repository.create({
      kind: "missed",
      callerId: CALLER_ID,
      calleeId: CALLEE_ID,
      endedAt,
      duration: 0,
    })).resolves.toBe(createdCall);

    expect(mocks.callHistoryCreate).toHaveBeenCalledOnce();
    expect(mocks.callHistoryCreate).toHaveBeenCalledWith({
      data: {
        callerId: CALLER_ID,
        calleeId: CALLEE_ID,
        status: "MISSED",
        endedAt,
        duration: 0,
      },
    });
    expect(mocks.callHistoryUpdate).not.toHaveBeenCalled();
  });

  it("updates an accepted call with only its completed status", async () => {
    mocks.callHistoryUpdate.mockResolvedValueOnce({ id: CALL_HISTORY_ID });

    await expect(repository.update({
      kind: "accepted",
      callHistoryId: CALL_HISTORY_ID,
      data: { status: "COMPLETED" },
    })).resolves.toBeUndefined();

    expect(mocks.callHistoryUpdate).toHaveBeenCalledOnce();
    expect(mocks.callHistoryUpdate).toHaveBeenCalledWith({
      where: { id: CALL_HISTORY_ID },
      data: { status: "COMPLETED" },
    });
    expect(mocks.callHistoryCreate).not.toHaveBeenCalled();
  });

  it.each([
    "MISSED",
    "COMPLETED",
    "REJECTED",
    "INTERRUPTED",
  ] as const)("preserves the %s terminal status and exact end data", async (status) => {
    const endedAt = new Date("2025-01-01T00:01:05.000Z");
    mocks.callHistoryUpdate.mockResolvedValueOnce({ id: CALL_HISTORY_ID });

    await expect(repository.update({
      kind: "terminal",
      callHistoryId: CALL_HISTORY_ID,
      data: {
        status,
        endedAt,
        duration: 65,
      },
    })).resolves.toBeUndefined();

    expect(mocks.callHistoryUpdate).toHaveBeenCalledOnce();
    expect(mocks.callHistoryUpdate).toHaveBeenCalledWith({
      where: { id: CALL_HISTORY_ID },
      data: {
        status,
        endedAt,
        duration: 65,
      },
    });
    expect(mocks.callHistoryCreate).not.toHaveBeenCalled();
  });

  it("passes create failures through unchanged", async () => {
    const failure = new Error("call create failed");
    mocks.callHistoryCreate.mockRejectedValueOnce(failure);

    await expect(repository.create({
      kind: "ringing",
      callerId: CALLER_ID,
      calleeId: CALLEE_ID,
    })).rejects.toBe(failure);
  });

  it("passes update failures through unchanged", async () => {
    const failure = new Error("call update failed");
    mocks.callHistoryUpdate.mockRejectedValueOnce(failure);

    await expect(repository.update({
      kind: "accepted",
      callHistoryId: CALL_HISTORY_ID,
      data: { status: "COMPLETED" },
    })).rejects.toBe(failure);
  });
});
