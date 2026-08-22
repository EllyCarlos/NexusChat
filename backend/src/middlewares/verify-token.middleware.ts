import { NextFunction, Response } from "express";
import jwt from 'jsonwebtoken';
import type { AuthenticatedRequest } from "../interfaces/auth/auth.interface.js";
import { prisma } from "../lib/prisma.lib.js";
import { CustomError, asyncErrorHandler } from "../utils/error.utils.js";
import { verifyApiSessionToken, type SessionTokenPayload } from "../utils/jwt.utils.js";

export const verifyToken = asyncErrorHandler(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {

    let token: string | undefined = undefined;

    // 1. Try to get the token from cookies (CHANGED: 'token' to 'session')
    if (req.cookies && req.cookies.session) { // <--- Changed from req.cookies.token
        token = req.cookies.session as string; // <--- Changed from req.cookies.token
    }

    // 2. If not in cookies, try to get from Authorization header (Bearer token)
    if (!token && req.headers.authorization) {
        const authHeader = req.headers.authorization;
        if (authHeader.startsWith("Bearer ")) {
            token = authHeader.split(" ")[1]; // Extract token from "Bearer <token>"
        }
    }

    // --- Critical Check: If no token is found after both attempts ---
    if (!token) {
        console.warn("Authentication: No token found in cookies or Authorization header.");
        return next(new CustomError("Token missing, please login again", 401));
    }

    // --- Ensure JWT_SECRET is available ---
    const secretKey = process.env.JWT_SECRET;
    if (!secretKey) {
        console.error("Server configuration error: JWT_SECRET environment variable is not defined!");
        return next(new CustomError("Server configuration error: JWT secret missing.", 500));
    }

    let decodedInfo: SessionTokenPayload;
    try {
        decodedInfo = verifyApiSessionToken(token);
    } catch (error) {
        // Catch specific JWT verification errors for clearer messages
        if (error instanceof jwt.TokenExpiredError) {
            console.error("JWT Error: Token expired.", error);
            return next(new CustomError("Authentication failed: Token expired, please login again.", 401));
        } else if (error instanceof jwt.JsonWebTokenError) {
            console.error(`JWT Error: Invalid token - ${error.message}`, error);
            return next(new CustomError(`Authentication failed: Invalid token - ${error.message}.`, 401));
        }
        // Catch any other unexpected errors during verification
        console.error("Unexpected error during JWT verification:", error);
        return next(new CustomError("Authentication failed: An unexpected error occurred.", 401));
    }

    // Fetch the user from the database
    const user = await prisma.user.findUnique({
        where: {
            id: decodedInfo.userId
        },
        select: {
            id: true,
            name: true,
            username: true,
            avatar: true,
            email: true,
            createdAt: true,
            updatedAt: true,
            emailVerified: true,
            publicKey: true,
            // --- ADDED: Include needsKeyRecovery and keyRecoveryCompletedAt ---
            needsKeyRecovery: true,
            keyRecoveryCompletedAt: true,
            notificationsEnabled: true,
            verificationBadge: true,
            fcmToken: true,
            oAuthSignup: true,
        }
    });

    if (!user) {
        console.warn(`Authentication: User not found for ID: ${decodedInfo.userId}`);
        return next(new CustomError('Invalid Token, user not found', 401));
    }

    // Attach the user object to the request for subsequent middleware/route handlers
    req.user = user;
    next();
});
