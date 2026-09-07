import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { createPrometheusMetricsAdapter } from "../src/infrastructure/metrics/prometheus-metrics.adapter.js";
import { emitLifecycleError } from "../src/observability/lifecycle-logger.js";
import { emitOperationError } from "../src/observability/operation-observer.js";
import { createOriginPolicy } from "../src/security/origin-policy.js";
import { createCapturingLogger } from "./support/capturing-logger.js";

const SENTINELS = [
  "AUTH_SECRET_VALUE_123",
  "COOKIE_SECRET_VALUE_456",
  "USER_SECRET_ID_789",
  "SOCKET_SECRET_ID_ABC",
  "CHAT_SECRET_ID_DEF",
  "MESSAGE_SECRET_ID_GHI",
  "CALL_SECRET_ID_JKL",
  "REDIS_SECRET_KEY_MNO",
  "DATABASE_SECRET_URL_PQR",
  "EMAIL_SECRET_VALUE_STU",
  "FIREBASE_SECRET_TOKEN_VWX",
  "OAUTH_SECRET_CODE_YZA",
  "QUERY_SECRET_VALUE_BCD",
  "SDP_SECRET_VALUE_EFG",
  "ICE_SECRET_VALUE_HIJ",
] as const;

describe("Phase 2E cross-cutting privacy certification", () => {
  it("keeps representative HTTP, Socket, provider, Redis, and metric output secret-free", async () => {
    const logger = createCapturingLogger("application");
    const metrics = createPrometheusMetricsAdapter({ clock: () => 1_000 });
    const router = express.Router();
    router.post("/privacy/:id", (_req, res) => res.status(204).send());
    const app = createApp({
      originPolicy: createOriginPolicy({
        environment: "test",
        frontendOrigin: "https://frontend.example",
      }),
      environment: "test",
      routes: [{ path: "/certification", router }],
      logger,
      metrics,
    });

    const response = await request(app)
      .post(`/certification/privacy/${SENTINELS[2]}?token=${SENTINELS[12]}`)
      .set("Origin", "https://frontend.example")
      .set("Authorization", `Bearer ${SENTINELS[0]}`)
      .set("Cookie", `session=${SENTINELS[1]}`)
      .set("X-Request-Id", "certification-request-1")
      .send({
        chatId: SENTINELS[4],
        messageId: SENTINELS[5],
        oauthCode: SENTINELS[11],
      });

    expect(response.status).toBe(204);
    expect(response.headers["x-request-id"]).toBe("certification-request-1");

    const privateFailure = new Error(SENTINELS.join(" "));
    emitOperationError(
      logger.forComponent("provider"),
      "provider.push_delivery.failed",
      privateFailure,
      { operation: "push_send", provider: "firebase", result: "failed" },
    );
    emitOperationError(
      logger.forComponent("socket"),
      "socket.ice_candidate.failed",
      privateFailure,
      { operation: "ice_candidate", result: "failed" },
    );
    emitLifecycleError(
      logger.forComponent("redis"),
      "redis.runtime.unavailable",
      privateFailure,
      { role: "command", state: "unavailable", result: "unavailable" },
    );

    metrics.recordSocketConnectionAdmission({ result: "accepted", reason: "none" });
    metrics.startSocketConnection({ runtimeMode: "distributed" }).complete();
    metrics.recordSocketOperationFailure("ice_candidate");
    metrics.recordSocketRateLimitRejection("message_send");
    metrics.recordSocketRateLimitProviderFailure("redis");
    metrics.recordRedisRuntimeState({ role: "command", state: "unavailable" });
    metrics.startConnectionMaintenance().complete("success");
    metrics.startPresenceReconciliation().complete("failed");

    const logs = JSON.stringify(logger.events);
    const exposition = (await metrics.render()).body;
    for (const sentinel of SENTINELS) {
      expect(logs).not.toContain(sentinel);
      expect(exposition).not.toContain(sentinel);
    }

    expect(logs).toContain("certification-request-1");
    expect(logs).toContain("/certification/privacy/:id");
    expect(exposition).not.toContain("certification-request-1");
    expect(exposition).toContain('route="/certification/privacy/:id"');
  });
});
