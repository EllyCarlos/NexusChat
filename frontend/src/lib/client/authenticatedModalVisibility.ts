export const shouldRenderAuthenticatedModals = (loggedInUser: unknown) =>
  loggedInUser !== null && loggedInUser !== undefined;
