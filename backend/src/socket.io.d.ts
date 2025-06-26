import { Socket } from "socket.io";
import { Prisma } from "@prisma/client";

declare module "socket.io" {
  interface Socket {
    user?: Omit<Prisma.UserCreateInput, "id" | "name" | "email" | "username"> &
      Required<Pick<Prisma.UserCreateInput, "id" | "name" | "email" | "username">>;
  }
}
