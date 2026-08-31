import type { SocketPresenceTransition } from "./connection-directory.js";
import type {
  SocketConnectionStateMaintenance,
} from "./connection-state-maintenance.js";

export const SOCKET_PRESENCE_CLAIM_TTL_MS = 60_000;
export const SOCKET_PRESENCE_RECONCILIATION_BATCH_SIZE = 100;
export const SOCKET_PRESENCE_RECONCILIATION_MAX_PASSES = 8;

export type ClaimedPresenceLoader =
  () => Promise<SocketPresenceTransition | undefined>;

/**
 * Persists presence while holding a cross-node, per-user serialization boundary.
 *
 * The implementation must acquire that boundary before invoking
 * `loadCurrentClaimedTruth`, apply only the transition returned by the loader,
 * and return that exact transition. An undefined transition is a no-op. This
 * ensures an expired or superseded Redis claim cannot authorize a later stale
 * database write.
 */
export interface SocketPresencePersistencePort {
  applySerialized(
    userId: string,
    loadCurrentClaimedTruth: ClaimedPresenceLoader,
  ): Promise<SocketPresenceTransition | undefined>;
}

/** Best-effort publication after the applied transition is confirmed current. */
export interface SocketPresencePublisherPort {
  publishPresence(transition: SocketPresenceTransition): Promise<void>;
}

export type SocketPresenceReconcilerOptions = {
  maintenance: SocketConnectionStateMaintenance;
  persistence: SocketPresencePersistencePort;
  publisher: SocketPresencePublisherPort;
  tokenFactory: () => string;
};

export class SocketPresenceReconciler {
  private readonly inFlightByUser = new Map<string, Promise<void>>();

  constructor(private readonly options: SocketPresenceReconcilerOptions) {}

  reconcileUser(userId: string): Promise<void> {
    const existing = this.inFlightByUser.get(userId);
    if (existing) return existing;

    let tracked: Promise<void>;
    tracked = this.reconcileCurrentTruth(userId).finally(() => {
      if (this.inFlightByUser.get(userId) === tracked) {
        this.inFlightByUser.delete(userId);
      }
    });
    this.inFlightByUser.set(userId, tracked);
    return tracked;
  }

  async reconcilePending(
    limit = SOCKET_PRESENCE_RECONCILIATION_BATCH_SIZE,
  ): Promise<number> {
    if (!Number.isSafeInteger(limit)
      || limit <= 0
      || limit > SOCKET_PRESENCE_RECONCILIATION_BATCH_SIZE) {
      throw new Error("Invalid presence reconciliation batch limit.");
    }

    const pending = await this.options.maintenance.listPendingPresence(limit);
    const userIds = [...new Set(pending.map(({ userId }) => userId))];
    await Promise.all(userIds.map((userId) => this.reconcileUser(userId)));
    return userIds.length;
  }

  async drain(): Promise<void> {
    await Promise.allSettled([...this.inFlightByUser.values()]);
  }

  private async reconcileCurrentTruth(userId: string): Promise<void> {
    for (let pass = 0;
      pass < SOCKET_PRESENCE_RECONCILIATION_MAX_PASSES;
      pass += 1) {
      const token = this.options.tokenFactory();
      if (token.length === 0) {
        throw new Error("Presence claim token factory returned an invalid token.");
      }

      const claimed = await this.options.maintenance.claimPresence(
        userId,
        token,
        SOCKET_PRESENCE_CLAIM_TTL_MS,
      );
      if (!claimed) return;

      let completed = false;
      try {
        const applied = await this.options.persistence.applySerialized(
          userId,
          () => this.options.maintenance.getClaimedPresence(userId, token),
        );

        if (!applied) continue;

        completed = await this.options.maintenance.completePresence(
          userId,
          token,
          applied.version,
        );
        if (!completed) continue;

        await this.options.publisher.publishPresence(applied);
        return;
      } finally {
        if (!completed) {
          await this.options.maintenance.releasePresence(userId, token);
        }
      }
    }
  }
}

export const createSocketPresenceReconciler = (
  options: SocketPresenceReconcilerOptions,
): SocketPresenceReconciler => new SocketPresenceReconciler(options);
