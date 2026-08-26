type OAuthRedirectLocation = Pick<Location, "hash" | "pathname">;
type OAuthRedirectHistory = Pick<History, "replaceState">;

type OAuthAuthenticationResult = {
  oauthSetup?: unknown;
  oauthMigration?: unknown;
  oauthMigrationError?: boolean;
};

export type OAuthAuthenticationPlan =
  | { kind: "setup" }
  | { kind: "migration" }
  | { kind: "migration-error"; message: string; redirectTo: "/" }
  | { kind: "login"; message: string; redirectTo: "/"; delayMs: number };

export type OAuthMigrationCompletionPlan =
  | { kind: "pending" }
  | { kind: "succeeded"; message: string; redirectTo: "/" }
  | { kind: "failed"; message: string; redirectTo: "/" };

export const readAndScrubOAuthExchangeToken = ({
  location,
  history,
}: {
  location: OAuthRedirectLocation;
  history: OAuthRedirectHistory;
}) => {
  if (!location.hash) {
    return null;
  }

  const fragment = new URLSearchParams(location.hash.slice(1));
  const token = fragment.get("token");

  // Replace the current history entry before token verification or key work.
  history.replaceState({}, "", location.pathname);

  return token?.trim() ? token : null;
};

export const getOAuthAuthenticationPlan = ({
  oauthSetup,
  oauthMigration,
  oauthMigrationError,
}: OAuthAuthenticationResult): OAuthAuthenticationPlan => {
  if (oauthSetup) {
    return { kind: "setup" };
  }
  if (oauthMigrationError) {
    return {
      kind: "migration-error",
      message: "Private-key backup migration was not completed.",
      redirectTo: "/",
    };
  }
  if (oauthMigration) {
    return { kind: "migration" };
  }
  return {
    kind: "login",
    message: "Successfully logged in!",
    redirectTo: "/",
    delayMs: 1_000,
  };
};

export const getOAuthMigrationCompletionPlan = (
  status: "idle" | "checking" | "migrating" | "skipped" | "succeeded" | "failed",
): OAuthMigrationCompletionPlan => {
  if (status === "failed") {
    return {
      kind: "failed",
      message: "Private-key backup migration was not completed.",
      redirectTo: "/",
    };
  }
  if (status === "skipped" || status === "succeeded") {
    return {
      kind: "succeeded",
      message: "Successfully logged in!",
      redirectTo: "/",
    };
  }
  return { kind: "pending" };
};
