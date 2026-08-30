import type { Server } from "socket.io";

import { Events } from "../enums/event/event.enum.js";
import type { SocketPresencePublisherPort } from "./presence-reconciler.js";

export const createSocketPresencePublisher = (
  io: Server,
): SocketPresencePublisherPort => ({
  publishPresence: async ({ userId, state, sourceSocketId }) => {
    const event = state === "online" ? Events.ONLINE_USER : Events.OFFLINE_USER;
    const payload = { userId };
    if (sourceSocketId) {
      io.except(sourceSocketId).emit(event, payload);
      return;
    }
    io.emit(event, payload);
  },
});
