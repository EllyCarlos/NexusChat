import type {
  PrivateKeyRecoveryOptions,
} from "@/interfaces/auth.interface";

const MANUAL_RECOVERY_COPY =
  "It looks like we’ve detected that your private key is missing. You can recover it by entering your account password. After entering the correct password, you will receive a verification email. Follow the link in that email to restore your private key.";

const LINKED_MANUAL_RECOVERY_COPY =
  "You signed in with Google, but your existing encryption backup remains protected by your original NexusChat password. Enter that password to receive a verification email and restore your private key.";

const OAUTH_RECOVERY_COPY =
  "It looks like we’ve detected that your private key is missing. You can recover it by verifying your email. Use the button below and follow the link in the verification email to restore your private key.";

export const getPrivateKeyRecoveryPresentation = ({
  recoveryMode,
  googleLinked,
}: PrivateKeyRecoveryOptions): {
  recoveryKind: "manual" | "oauth";
  copy: string;
} => {
  if (recoveryMode === "manual-v1") {
    return {
      recoveryKind: "manual",
      copy: googleLinked ? LINKED_MANUAL_RECOVERY_COPY : MANUAL_RECOVERY_COPY,
    };
  }

  return {
    recoveryKind: "oauth",
    copy: OAUTH_RECOVERY_COPY,
  };
};
