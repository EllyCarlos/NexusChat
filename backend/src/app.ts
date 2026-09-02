import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Request, type Response, type Router } from "express";
import helmet from "helmet";
import passport from "passport";
import type { MetricsConfig } from "./interfaces/config/config.interface.js";
import type { LoggerPort } from "./observability/logger.port.js";
import type { MetricsPort } from "./observability/metrics.port.js";
import { noopLogger } from "./observability/noop-logger.js";
import { noopMetrics } from "./observability/noop-metrics.js";
import { errorMiddleware, notFoundMiddleware } from "./middlewares/error.middleware.js";
import {
  createHttpObservabilityMiddleware,
  createRouteTemplateBaseMiddleware,
} from "./middlewares/http-observability.middleware.js";
import {
  createMetricsEndpointHandler,
  markMetricsRequest,
} from "./middlewares/metrics-endpoint.middleware.js";
import { REQUEST_ID_HEADER } from "./observability/request-id.js";
import {
  createCorsOriginDelegate,
  createMutationOriginMiddleware,
  type OriginPolicy,
} from "./security/origin-policy.js";

type AppRoute = {
  path: string;
  router: Router;
};

type CreateAppOptions = {
  originPolicy: OriginPolicy;
  environment: string;
  routes?: AppRoute[];
  readiness?: () => boolean;
  logger?: LoggerPort;
  metrics?: MetricsPort;
  metricsConfiguration?: MetricsConfig;
};

export const createApp = ({
  originPolicy,
  environment,
  routes = [],
  readiness = () => true,
  logger = noopLogger,
  metrics = noopMetrics,
  metricsConfiguration = { enabled: false },
}: CreateAppOptions) => {
  const metricsBearerToken = metricsConfiguration.bearerToken;
  if (metricsConfiguration.enabled && !metricsBearerToken) {
    throw new TypeError("Metrics bearer credential is required when metrics are enabled.");
  }
  const app = express();

  app.set("logger", logger);
  if (metricsConfiguration.enabled) {
    app.get("/metrics", markMetricsRequest);
  }
  app.use(createHttpObservabilityMiddleware({ logger, metrics }));

  app.disable("x-powered-by");
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
    originAgentCluster: false,
    referrerPolicy: { policy: "no-referrer" },
    strictTransportSecurity: environment === "production"
      ? { maxAge: 31_536_000, includeSubDomains: false, preload: false }
      : false,
    xContentTypeOptions: true,
    xDnsPrefetchControl: { allow: false },
    xDownloadOptions: true,
    xFrameOptions: { action: "deny" },
    xPermittedCrossDomainPolicies: { permittedPolicies: "none" },
    xXssProtection: true,
  }));

  app.use(cors({
    credentials: true,
    exposedHeaders: [REQUEST_ID_HEADER],
    origin: createCorsOriginDelegate(originPolicy),
  }));
  app.use(createMutationOriginMiddleware(originPolicy));
  app.use(passport.initialize());
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));
  app.use(cookieParser());
  if (metricsConfiguration.enabled && metricsBearerToken) {
    app.get("/metrics", createMetricsEndpointHandler({
      metrics,
      bearerToken: metricsBearerToken,
    }));
  }
  app.use("/api/v1/auth", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  for (const route of routes) {
    app.use(route.path, createRouteTemplateBaseMiddleware(route.path), route.router);
  }

  app.get("/", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ status: "ok" });
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    if (!readiness()) {
      res.status(503).json({ status: "unavailable" });
      return;
    }
    res.status(200).json({ status: "ok" });
  });

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
};
