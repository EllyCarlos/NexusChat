import { NextFunction } from "connect";
import cookie from 'cookie';
import jwt from 'jsonwebtoken';
import { Socket } from "socket.io";
import { prisma } from "../lib/prisma.lib.js";
import { CustomError } from "../utils/error.utils.js";

type SessionPayload = {
    userId: string;
    expiresAt: Date;
};
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

        // Verify JWT and get payload
        const decodedPayload = jwt.verify(token, secret, { algorithms: ["HS256"] }) as jwt.JwtPayload;

        // Validate the decoded payload
        if (!decodedPayload || typeof decodedPayload !== 'object' || !decodedPayload.userId) {
            return next(new CustomError("Invalid token please login again", 401));
        }

        // Check token expiration if needed
        if (decodedPayload.exp && Date.now() >= decodedPayload.exp * 1000) {
            return next(new CustomError("Token expired, please login again", 401));
        }

        const existingUser = await prisma.user.findUnique({
            where: { id: decodedPayload.userId as string }
        });

        if (!existingUser) {
            return next(new CustomError('Invalid Token, please login again', 401));
        }

        socket.user = existingUser;
        next();

    } catch (error) {
        console.log("Socket auth error:", error);
        if (error instanceof jwt.JsonWebTokenError) {
            return next(new CustomError("Invalid token format", 401));
        }
        if (error instanceof jwt.TokenExpiredError) {
            return next(new CustomError("Token expired, please login again", 401));
        }
        return next(new CustomError("Invalid Token, please login again", 401));
    }
}