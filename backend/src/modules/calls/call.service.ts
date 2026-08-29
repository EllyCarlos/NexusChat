import type { Server, Socket } from "socket.io";
import type { SocketConnectionRegistry } from "../../socket/connection-registry.js";
import { sendPushNotification } from "../notifications/push-notification.service.js";
import { createCallSignalingService } from "./application/call-signaling.service.js";
import { prismaCallHistoryRepository } from "./infrastructure/prisma-call-history.repository.js";
import { createRegistryCallPeerLocator } from "./infrastructure/registry-call-peer-locator.adapter.js";
import { createSocketCallRealtimeAdapter } from "./infrastructure/socket-call-realtime.adapter.js";

type SocketCallSignalingComposition = {
  io: Server;
  socket: Socket;
  registry: SocketConnectionRegistry;
};

export const createSocketCallSignalingService = ({
  io,
  socket,
  registry,
}: SocketCallSignalingComposition) => createCallSignalingService({
  history: prismaCallHistoryRepository,
  peers: createRegistryCallPeerLocator(registry),
  realtime: createSocketCallRealtimeAdapter({ io, socket }),
  notifyMissedCall: ({ recipientToken, title, body }) => {
    sendPushNotification({
      recipientToken,
      title,
      body,
    });
  },
  clock: () => new Date(),
});
