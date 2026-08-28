import type { Server } from "socket.io";
import { Events } from "../../../enums/event/event.enum.js";
import { emitEventToRoom } from "../../../utils/socket.util.js";
import type { AttachmentRealtimePort } from "../contracts/attachment-realtime.port.js";

export type SocketServerResolver = () => Server;

export const createSocketAttachmentRealtimeAdapter = (
  resolveSocketServer: SocketServerResolver,
): AttachmentRealtimePort => {
  let resolvedSocketServer: { value: Server } | undefined;

  const getSocketServer = (): Server => {
    if (!resolvedSocketServer) {
      resolvedSocketServer = { value: resolveSocketServer() };
    }
    return resolvedSocketServer.value;
  };

  return {
    emitMessage: (chatId, payload) => {
      emitEventToRoom({
        io: getSocketServer(),
        event: Events.MESSAGE,
        room: chatId,
        data: payload,
      });
    },

    emitUnreadMessage: (chatId, payload) => {
      emitEventToRoom({
        io: getSocketServer(),
        event: Events.UNREAD_MESSAGE,
        room: chatId,
        data: payload,
      });
    },
  };
};
