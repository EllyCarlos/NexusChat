type OAuthRedirectLocation = Pick<Location, "hash" | "pathname">;
type OAuthRedirectHistory = Pick<History, "replaceState">;

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
