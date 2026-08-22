import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Request, type Response, type Router } from "express";
import passport from "passport";
import { errorMiddleware, notFoundMiddleware } from "./middlewares/error.middleware.js";
import { createRequestLogger } from "./middlewares/request-logger.middleware.js";
import {
  createCorsOriginDelegate,
  createMutationOriginMiddleware,
  type OriginPolicy,
} from "./security/origin-policy.js";

export type AppRoute = {
  path: string;
  router: Router;
};

export type CreateAppOptions = {
  originPolicy: OriginPolicy;
  environment: string;
  routes?: AppRoute[];
  requestLogger?: ReturnType<typeof createRequestLogger>;
  getConnectedClientCount?: () => number;
  io?: unknown;
};

export const createApp = ({
  originPolicy,
  environment,
  routes = [],
  requestLogger = createRequestLogger(),
  getConnectedClientCount = () => 0,
  io,
}: CreateAppOptions) => {
  const app = express();

  if (io !== undefined) {
    app.set("io", io);
  }

  app.use(cors({
    credentials: true,
    origin: createCorsOriginDelegate(originPolicy),
  }));
  app.use(createMutationOriginMiddleware(originPolicy));
  app.use(passport.initialize());
  app.use(express.json());
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));
  app.use(cookieParser());
  app.use(requestLogger);

  for (const route of routes) {
    app.use(route.path, route.router);
  }

  app.get("/", (_req: Request, res: Response) => {
    res.status(200).json({
      status: "OK",
      running: true,
      timestamp: new Date().toISOString(),
      environment,
      uptime: Math.floor(process.uptime()),
      connectedClients: getConnectedClientCount(),
    });
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      services: {
        server: "running",
        socket: `${getConnectedClientCount()} clients connected`,
        memory: {
          used: `${Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100} MB`,
          total: `${Math.round((process.memoryUsage().heapTotal / 1024 / 1024) * 100) / 100} MB`,
        },
      },
    });
  });

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
};
