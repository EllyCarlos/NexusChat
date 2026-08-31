import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../interfaces/auth/auth.interface.js";
import {
  createFriendRequestRealtime,
  getFriendRequests,
  prepareCreateFriendRequest,
  prepareHandleFriendRequest,
} from "../modules/friend-requests/friend-request.service.js";
import {
  BACKEND_RATE_LIMITS,
  enforcePairRateLimit,
} from "../middlewares/rate-limit.middleware.js";
import type {
  createRequestSchemaType,
  handleRequestSchemaType,
} from "../schemas/request.schema.js";
import { asyncErrorHandler } from "../utils/error.utils.js";

export const getUserRequests = asyncErrorHandler(async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const friendRequests = await getFriendRequests(req.user.id);
  return res.status(200).json(friendRequests);
});

export const createRequest = asyncErrorHandler(async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  const { receiver }: createRequestSchemaType = req.body;
  const preparedRequest = await prepareCreateFriendRequest({
    actor: {
      id: req.user.id,
      username: req.user.username,
    },
    receiverId: receiver,
  });

  if (!enforcePairRateLimit({
    response: res,
    next,
    actorUserId: req.user.id,
    otherUserId: preparedRequest.rateLimitPeerId,
    policy: BACKEND_RATE_LIMITS.friendCreateCooldown,
    secondPolicy: BACKEND_RATE_LIMITS.friendCreateWindow,
  })) return;

  await preparedRequest.execute(createFriendRequestRealtime(
    () => req.app.get("io"),
    () => req.app.get("connectionDirectory"),
  ));
  return res.status(201).json({});
});

export const handleRequest = asyncErrorHandler(async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  const { id } = req.params;
  const { action }: handleRequestSchemaType = req.body;
  const preparedRequest = await prepareHandleFriendRequest({
    actor: {
      id: req.user.id,
      username: req.user.username,
    },
    requestId: id,
    action,
  });

  if (!enforcePairRateLimit({
    response: res,
    next,
    actorUserId: req.user.id,
    otherUserId: preparedRequest.rateLimitPeerId,
    policy: BACKEND_RATE_LIMITS.friendHandle,
  })) return;

  const handledRequestId = await preparedRequest.execute(
    createFriendRequestRealtime(
      () => req.app.get("io"),
      () => req.app.get("connectionDirectory"),
    ),
  );
  return res.status(200).json({ id: handledRequestId });
});
