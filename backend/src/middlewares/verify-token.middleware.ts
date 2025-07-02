import { NextFunction, Response } from "express";
import jwt from 'jsonwebtoken';
import type { AuthenticatedRequest } from "../interfaces/auth/auth.interface.js";
import { prisma } from "../lib/prisma.lib.js";
import { CustomError, asyncErrorHandler } from "../utils/error.utils.js";


type SessionPayload = {
    userId: string;
    expiresAt: number; // JWT expiration is usually a Unix timestamp (number), not a Date object directly in the payload
    // Add other properties you expect in your JWT payload here, e.g.:
    // isNewUser?: boolean;
    // type?: string; // e.g., "oauth-temp"
    // email?: string;
};

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

    let decodedInfo: SessionPayload;
    try {
        // Verify the token using the secret key and explicitly specify the algorithm
        decodedInfo = jwt.verify(token, secretKey, { algorithms: ['HS256'] }) as SessionPayload;
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

    // Validate the decoded payload structure
    if (!decodedInfo || typeof decodedInfo.userId !== 'string') {
        console.warn("Authentication: Invalid token payload structure or missing userId.");
        return next(new CustomError("Invalid token payload, please login again", 401));
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