import type { SocketAuthenticatedIdentity } from "./modules/auth/contracts/auth-identity.js";

declare module "socket.io" {
   interface Socket {
     user: SocketAuthenticatedIdentity;
   }
}
