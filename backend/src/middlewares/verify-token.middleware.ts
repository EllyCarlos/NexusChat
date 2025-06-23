import { NextFunction, Response } from "express"
import jwt from 'jsonwebtoken'
import type { AuthenticatedRequest } from "../interfaces/auth/auth.interface.js"
import { prisma } from "../lib/prisma.lib.js"
import { CustomError, asyncErrorHandler } from "../utils/error.utils.js"


type SessionPayload = {
    userId: string;
    expiresAt: number; // JWT expiration is usually a Unix timestamp (number), not a Date object directly in the payload
};

  
export const verifyToken=asyncErrorHandler(async(req:AuthenticatedRequest,res:Response,next:NextFunction)=>{

        let {token} = req.cookies

        // !!! FIX 1: Ensure secretKey is a string and not undefined !!!
        const secretKey = process.env.JWT_SECRET; 

        if (!secretKey) {
            // This error happens during runtime if the env var isn't set
            console.error("JWT_SECRET environment variable is not defined!");
            return next(new CustomError("Server configuration error: JWT secret missing.", 500));
        }

        if (!token && req.headers.authorization) {
            const authHeader = req.headers.authorization;
            if (authHeader.startsWith("Bearer ")) {
              token = authHeader.split(" ")[1]; // Extract token from "Bearer <token>"
            }
          }
        
        if (!token) {
            return next(new CustomError("Token missing, please login again", 401));
        }

        let decodedInfo: SessionPayload;
        try {
            // FIX 2: Better type assertion and algorithm check
            decodedInfo = jwt.verify(token, secretKey, { algorithms: ['HS256'] }) as SessionPayload;
        } catch (error) {
            // Catch JWT verification errors specifically (e.g., invalid signature, expired token)
            if (error instanceof jwt.JsonWebTokenError) {
                return next(new CustomError(`Unauthorized: ${error.message}`, 401));
            }
            console.error("Unexpected JWT verification error:", error);
            return next(new CustomError("Unauthorized: Invalid token.", 401));
        }

        if(!decodedInfo || typeof decodedInfo.userId !== 'string'){ // Also check type of userId
            return next(new CustomError("Invalid token payload, please login again",401))
        }

        const user = await prisma.user.findUnique({
            where:{
                id:decodedInfo.userId
            },
            select:{
                id:true,
                name:true,
                username:true,
                avatar:true,
                email:true,
                createdAt:true,
                updatedAt:true,
                emailVerified:true,
                publicKey:true,
                notificationsEnabled:true,
                verificationBadge:true,
                fcmToken:true,
                oAuthSignup:true,
            }
        })

        if(!user){
            return next(new CustomError('Invalid Token, user not found',401))
        }
        req.user=user
        next()
})