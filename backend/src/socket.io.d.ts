import { Socket } from "socket.io";

declare module "socket.io" {
  interface Socket {
    user?: Omit<Prisma.UserCreateInput, "id" | "name" | "email" | "username"> &
      Required<Pick<Prisma.UserCreateInput, "id" | "name" | "email" | "username">>;
  }
}
