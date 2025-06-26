import { Socket } from "socket.io";
import { Prisma } from "@prisma/client";


declare module "socket.io" {
   interface Socket {
         // Simplified: Assumes your authentication attaches a complete Prisma.User object.
     // This will allow TypeScript to infer the correct types for user properties
     // based on your Prisma schema.
     user?: Prisma.User;
   }
}