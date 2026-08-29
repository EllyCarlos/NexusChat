import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Request, type Response, type Router } from "express";
import helmet from "helmet";
import passport from "passport";
import { errorMiddleware, notFoundMiddleware } from "./middlewares/error.middleware.js";
import { createRequestLogger } from "./middlewares/request-logger.middleware.js";
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
  requestLogger?: ReturnType<typeof createRequestLogger>;
};

export const createApp = ({
  originPolicy,
  environment,
  routes = [],
  requestLogger = createRequestLogger(),
}: CreateAppOptions) => {
  const app = express();

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
    origin: createCorsOriginDelegate(originPolicy),
  }));
  app.use(createMutationOriginMiddleware(originPolicy));
  app.use(passport.initialize());
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));
  app.use(cookieParser());
  app.use(requestLogger);
  app.use("/api/v1/auth", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  for (const route of routes) {
    app.use(route.path, route.router);
  }

  app.get("/", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ status: "ok" });
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ status: "ok" });
  });

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
};
