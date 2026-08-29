import type { CallStatus } from "./call.types.js";

export type CreateCallHistoryInput =
  | {
      kind: "ringing";
      callerId: string;
      calleeId: string;
    }
  | {
      kind: "missed";
      callerId: string;
      calleeId: string;
      endedAt: Date;
      duration: 0;
    };

export interface CreatedCallHistory {
  id: string;
}

export type TerminalCallStatus = Exclude<CallStatus, "RINGING">;

export type UpdateCallHistoryInput =
  | {
      kind: "accepted";
      callHistoryId: string;
      data: {
        status: "COMPLETED";
      };
    }
  | {
      kind: "terminal";
      callHistoryId: string;
      data: {
        status: TerminalCallStatus;
        endedAt: Date;
        duration: number;
      };
    };

export interface CallHistoryRepository {
  create(input: CreateCallHistoryInput): Promise<CreatedCallHistory>;
  update(input: UpdateCallHistoryInput): Promise<void>;
}
