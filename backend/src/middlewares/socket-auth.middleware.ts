import { NextFunction } from "connect";
import jwt from 'jsonwebtoken';
import { Socket } from "socket.io";
import { prisma } from "../lib/prisma.lib.js";
import { CustomError } from "../utils/error.utils.js";
import { verifySocketSessionToken } from "../utils/jwt.utils.js";
import { logServerError } from "../utils/safe-logger.utils.js";

export const MAX_SOCKET_TOKEN_LENGTH = 4_096;

export const hasPlausibleJwtShape = (token: unknown): token is string =>
    typeof token === "string"
    && token.length > 0
    && token.length <= MAX_SOCKET_TOKEN_LENGTH
    && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);

export const socketAuthenticatorMiddleware = async (socket: Socket, next: NextFunction) => {
    try {
        const token = socket.handshake.query.token;
        if (token === undefined) {
            return next(new CustomError("Token missing, please login again", 401));
        }
        if (!hasPlausibleJwtShape(token)) {
            return next(new CustomError("Invalid token format", 401));
        }

        const decodedPayload = verifySocketSessionToken(token);

        const existingUser = await prisma.user.findUnique({
            where: { id: decodedPayload.userId }
        });

        if (!existingUser) {
            return next(new CustomError('Invalid Token, please login again', 401));
        }

        socket.user = existingUser;
        next();

    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            return next(new CustomError("Token expired, please login again", 401));
        }
        if (error instanceof jwt.JsonWebTokenError) {
            return next(new CustomError("Invalid token format", 401));
        }
        logServerError("Socket authentication failed.", error);
        return next(new CustomError("Invalid Token, please login again", 401));
    }
}
