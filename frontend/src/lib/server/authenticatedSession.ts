import "server-only";

import { cookies } from "next/headers";
import { verifySessionToken } from "./session";

export type AuthenticatedSession = {
  userId: string;
  token: string;
};

export const getAuthenticatedSession = async (): Promise<AuthenticatedSession | null> => {
  const token = (await cookies()).get("session")?.value;
  const session = await verifySessionToken(token);

  if (!token || !session) {
    return null;
  }

  return {
    userId: session.userId,
    token,
  };
};
