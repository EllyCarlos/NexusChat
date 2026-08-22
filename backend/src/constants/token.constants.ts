export const TOKEN_ISSUERS = {
  WEB: "urn:nexuschat:web",
  API: "urn:nexuschat:api",
} as const;

export const TOKEN_AUDIENCES = {
  WEB: "urn:nexuschat:web",
  API: "urn:nexuschat:api",
  SOCKET: "urn:nexuschat:socket",
} as const;

export const SESSION_TOKEN_AUDIENCES = [
  TOKEN_AUDIENCES.WEB,
  TOKEN_AUDIENCES.API,
  TOKEN_AUDIENCES.SOCKET,
] as const;

export type TokenIssuer = (typeof TOKEN_ISSUERS)[keyof typeof TOKEN_ISSUERS];
export type TokenAudience = (typeof TOKEN_AUDIENCES)[keyof typeof TOKEN_AUDIENCES];
