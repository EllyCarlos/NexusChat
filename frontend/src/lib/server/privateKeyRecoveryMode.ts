import "server-only";

import type { PrivateKeyRecoveryMode } from "@/interfaces/auth.interface";
import { parsePrivateKeyBackup } from "@/lib/client/privateKeyEnvelope";

export const derivePrivateKeyRecoveryMode = ({
  privateKey,
  oAuthSignup,
}: {
  privateKey: string | null;
  oAuthSignup: boolean;
}): PrivateKeyRecoveryMode => {
  if (!privateKey) {
    throw new Error("Private-key recovery is unavailable.");
  }

  const backup = parsePrivateKeyBackup(privateKey);
  if (backup.format === "legacy-v1") {
    return oAuthSignup ? "oauth-v1" : "manual-v1";
  }

  if (!oAuthSignup) {
    throw new Error("Private-key recovery lineage is inconsistent.");
  }

  return "oauth-v2";
};
