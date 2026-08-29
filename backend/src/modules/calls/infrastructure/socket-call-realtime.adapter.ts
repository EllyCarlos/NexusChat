import type { Server, Socket } from "socket.io";
import { Events } from "../../../enums/event/event.enum.js";
import type { CallRealtimePort } from "../contracts/call-realtime.port.js";

type SocketCallRealtimeAdapterInput = {
  io: Server;
  socket: Socket;
};

export const createSocketCallRealtimeAdapter = ({
  io,
  socket,
}: SocketCallRealtimeAdapterInput): CallRealtimePort => ({
  emitCallIdToActor: (payload) => {
    socket.emit(Events.CALL_ID, payload);
  },

  emitCallEndToActor: () => {
    socket.emit(Events.CALL_END);
  },

  emitCalleeOfflineToActor: () => {
    socket.emit(Events.CALLEE_OFFLINE);
  },

  emitCallerOfflineToActor: () => {
    socket.emit(Events.CALLER_OFFLINE);
  },

  emitIncomingCall: (targetSocketId, payload) => {
    io.to(targetSocketId).emit(Events.INCOMING_CALL, payload);
  },

  emitCallAccepted: (targetSocketId, payload) => {
    socket.to(targetSocketId).emit(Events.CALL_ACCEPTED, payload);
  },

  emitCallRejected: (targetSocketId) => {
    socket.to(targetSocketId).emit(Events.CALL_REJECTED);
  },

  emitCallEndToPeerViaSocket: (targetSocketId) => {
    socket.to(targetSocketId).emit(Events.CALL_END);
  },

  emitCallEndToPeerViaServer: (targetSocketId) => {
    io.to(targetSocketId).emit(Events.CALL_END);
  },

  emitCalleeBusy: (targetSocketId) => {
    socket.to(targetSocketId).emit(Events.CALLEE_BUSY);
  },

  emitIceCandidate: (targetSocketId, payload) => {
    io.to(targetSocketId).emit(Events.ICE_CANDIDATE, payload);
  },

  emitNegotiationNeeded: (targetSocketId, payload) => {
    socket.to(targetSocketId).emit(Events.NEGO_NEEDED, payload);
  },

  emitNegotiationFinal: (targetSocketId, payload) => {
    socket.to(targetSocketId).emit(Events.NEGO_FINAL, payload);
  },
});
