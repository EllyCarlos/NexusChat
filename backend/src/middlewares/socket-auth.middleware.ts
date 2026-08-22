import { NextFunction } from "connect";
import jwt from 'jsonwebtoken';
import { Socket } from "socket.io";
import { prisma } from "../lib/prisma.lib.js";
import { CustomError } from "../utils/error.utils.js";
import { verifySocketSessionToken } from "../utils/jwt.utils.js";
import { logServerError } from "../utils/safe-logger.utils.js";

export const socketAuthenticatorMiddleware = async (socket: Socket, next: NextFunction) => {
    try {
        const token = socket.handshake.query.token as string;
        if (!token) {
            return next(new CustomError("Token missing, please login again", 401));
        }

        const secret = process.env.JWT_SECRET;
        if (!secret) {
            console.error("JWT_SECRET environment variable is not set");
            return next(new CustomError("Server configuration error", 500));
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
        logServerError("Socket authentication failed.", error);
        if (error instanceof jwt.JsonWebTokenError) {
            return next(new CustomError("Invalid token format", 401));
        }
        if (error instanceof jwt.TokenExpiredError) {
            return next(new CustomError("Token expired, please login again", 401));
        }
        return next(new CustomError("Invalid Token, please login again", 401));
    }
}
