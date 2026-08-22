import { createServer, type IncomingMessage } from "node:http";
import { readFileSync } from "node:fs";
import request from "supertest";
import { Server } from "socket.io";
import { describe, expect, it, vi } from "vitest";
import {
  createOriginPolicy,
  createSocketAllowRequest,
  PRODUCTION_FRONTEND_ORIGIN,
} from "../src/security/origin-policy.js";

const policy = createOriginPolicy({
  environment: "production",
  frontendOrigin: PRODUCTION_FRONTEND_ORIGIN,
});
const allowRequest = createSocketAllowRequest(policy);

const evaluateAdmission = (transport: "polling" | "websocket", origin?: string) =>
  new Promise<boolean>((resolve, reject) => {
    const request = {
      headers: origin === undefined ? {} : { origin },
      url: `/socket.io/?EIO=4&transport=${transport}`,
    } as IncomingMessage;

    allowRequest(request, (error, allowed) => {
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve(allowed);
    });
  });

const requestPollingHandshake = async (origin: string) => {
  const httpServer = createServer();
  const io = new Server(httpServer, {
    cors: { credentials: true, origin: [...policy.origins] },
    allowRequest,
  });
  const socketAuthentication = vi.fn((_socket, next) => next());
  io.use(socketAuthentication);

  try {
    const response = await request(httpServer)
      .get("/socket.io/?EIO=4&transport=polling")
      .set("Origin", origin);
    return { response, socketAuthentication };
  } finally {
    io.close();
  }
};

describe("Socket.IO transport origin admission", () => {
  it("admits polling from the exact browser frontend origin", async () => {
    await expect(evaluateAdmission("polling", PRODUCTION_FRONTEND_ORIGIN)).resolves.toBe(true);
  });

  it("rejects hostile polling origin", async () => {
    await expect(evaluateAdmission("polling", "https://attacker.example")).resolves.toBe(false);
  });

  it("allows the real Engine.IO polling handshake for the frontend origin", async () => {
    const { response } = await requestPollingHandshake(PRODUCTION_FRONTEND_ORIGIN);

    expect(response.status).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe(PRODUCTION_FRONTEND_ORIGIN);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("rejects the real Engine.IO polling handshake before Socket authentication", async () => {
    const { response, socketAuthentication } = await requestPollingHandshake("https://attacker.example");

    expect(response.status).toBe(403);
    expect(socketAuthentication).not.toHaveBeenCalled();
  });

  it("admits WebSocket upgrade from the exact browser frontend origin", async () => {
    await expect(evaluateAdmission("websocket", PRODUCTION_FRONTEND_ORIGIN)).resolves.toBe(true);
  });

  it("rejects hostile WebSocket origin", async () => {
    await expect(evaluateAdmission("websocket", "https://attacker.example")).resolves.toBe(false);
  });

  it("allows missing Origin for non-browser Socket clients", async () => {
    await expect(evaluateAdmission("websocket")).resolves.toBe(true);
  });

  it("configures Engine.IO admission before Socket authentication", () => {
    const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

    expect(source.indexOf("allowRequest: createSocketAllowRequest(originPolicy)")).toBeGreaterThan(-1);
    expect(source.indexOf("allowRequest: createSocketAllowRequest(originPolicy)")).toBeLessThan(
      source.indexOf("io.use(socketAuthenticatorMiddleware)"),
    );
  });
});
