import { NextFunction, Request, Response } from "express";
import jwt from 'jsonwebtoken';
import { config } from "../config/env.config.js";
import type { AuthenticatedRequest, OAuthAuthenticatedRequest } from "../interfaces/auth/auth.interface.js";
import { prisma } from '../lib/prisma.lib.js';
import type { fcmTokenSchemaType } from "../schemas/auth.schema.js";
import { env } from "../schemas/env.schema.js";
import { CustomError, asyncErrorHandler } from "../utils/error.utils.js";

const getUserInfo = asyncErrorHandler(async(req:AuthenticatedRequest,res:Response,next:NextFunction)=>{
    const user = req.user
    const secureUserInfo = {
        id:user.id,
        name:user.name,
        username:user.username,
        avatar:user.avatar,
        email:user.email,
        createdAt:user.createdAt,
        updatedAt:user.updatedAt,
        emailVerified:user.emailVerified,
        publicKey:user.publicKey,
        notificationsEnabled:user.notificationsEnabled,
        verificationBadge:user.verificationBadge,
        fcmToken:user.fcmToken,
        oAuthSignup:user.oAuthSignup
    }
    return res.status(200).json(secureUserInfo)
})

const updateFcmToken = asyncErrorHandler(async(req:AuthenticatedRequest,res:Response,next:NextFunction)=>{
    const {fcmToken}:fcmTokenSchemaType = req.body
    const user =  await prisma.user.update({
        where:{
            id:req.user.id
        },
        data:{
            fcmToken
        }
    })
    return res.status(200).json({fcmToken:user.fcmToken})
})

const checkAuth = asyncErrorHandler(async(req:AuthenticatedRequest,res:Response,next:NextFunction)=>{
    if(req.user){
        const secureUserInfo = {
            id:req.user.id,
            name:req.user.name,
            username:req.user.username,
            avatar:req.user.avatar,
            email:req.user.email,
            createdAt:req.user.createdAt,
            updatedAt:req.user.updatedAt,
            emailVerified:req.user.emailVerified,
            publicKey:req.user.publicKey,
            notificationsEnabled:req.user.notificationsEnabled,
            verificationBadge:req.user.verificationBadge,
            fcmToken:req.user.fcmToken,
            oAuthSignup:req.user.oAuthSignup
        }
        return res.status(200).json(secureUserInfo)
    }
    return next(new CustomError("Token missing, please login again",401))
})

const redirectHandler = asyncErrorHandler(async(req:OAuthAuthenticatedRequest,res:Response,next:NextFunction)=>{
    try {
        if(req.user){
            console.log('OAuth redirect - User data:', {
                userId: req.user.id,
                isNewUser: req.user.newUser,
                userEmail: req.user.email // for debugging
            });

            // ✅ Fixed: Use consistent field names that match your frontend expectations
            const tempToken = jwt.sign({
                userId: req.user.id,        // Changed from 'user' to 'userId'
                type: req.user.newUser ? 'new' : 'existing',  // Changed from 'oAuthNewUser' to 'type'
                isNewUser: req.user.newUser, // Keep both for backward compatibility
                iat: Math.floor(Date.now() / 1000)
            }, env.JWT_SECRET, {expiresIn:"5m"});

            console.log('Generated OAuth token payload:', {
                userId: req.user.id,
                type: req.user.newUser ? 'new' : 'existing',
                isNewUser: req.user.newUser
            });

            return res.redirect(307, `${config.clientUrl}/auth/oauth-redirect?token=${tempToken}`);
        }
        else{
            console.log('OAuth redirect - No user found, redirecting to login');
            return res.redirect(`${config.clientUrl}/auth/login`);
        }
    } catch (error) {
        console.error('Error during oauth redirect handler:', error);
        return res.redirect(`${config.clientUrl}/auth/login?error=${encodeURIComponent('OAuth processing failed')}`);
    }
})

// ✅ Add a token verification function for your frontend to use
const verifyOAuthToken = asyncErrorHandler(async(req: Request, res: Response, next: NextFunction) => {
    try {
        const { token } = req.body;
        
        if (!token) {
            return next(new CustomError("Token is required", 400));
        }

        console.log('Verifying OAuth token...');
        
        // Decode and verify the token
        const decoded = jwt.verify(token, env.JWT_SECRET) as any;
        
        console.log('Decoded token payload:', {
            userId: decoded.userId,
            type: decoded.type,
            isNewUser: decoded.isNewUser,
            iat: decoded.iat,
            exp: decoded.exp
        });

        // Validate required fields
        if (!decoded.userId) {
            console.error('Token validation failed: missing userId');
            return next(new CustomError("Invalid token: missing user identifier", 401));
        }

        // Fetch user from database
        const user = await prisma.user.findUnique({
            where: { id: decoded.userId }
        });

        if (!user) {
            console.error('Token validation failed: user not found');
            return next(new CustomError("Invalid token: user not found", 401));
        }

        // Prepare response data
        const responseData: any = {
            user: {
                id: user.id,
                name: user.name,
                username: user.username,
                avatar: user.avatar,
                email: user.email,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt,
                emailVerified: user.emailVerified,
                publicKey: user.publicKey,
                notificationsEnabled: user.notificationsEnabled,
                verificationBadge: user.verificationBadge,
                fcmToken: user.fcmToken,
                oAuthSignup: user.oAuthSignup
            }
        };

        // If this is a new user, include the combined secret
        if (decoded.isNewUser) {
            // Generate a combined secret for key generation
            const combinedSecret = `${user.id}_${user.email}_${Date.now()}`;
            responseData.combinedSecret = combinedSecret;
            console.log('New user detected, including combinedSecret');
        }

        console.log('Token verification successful for user:', user.id);
        return res.status(200).json(responseData);

    } catch (error) {
        console.error('OAuth token verification error:', error);
        
        if (error instanceof jwt.JsonWebTokenError) {
            return next(new CustomError("Invalid token", 401));
        }
        if (error instanceof jwt.TokenExpiredError) {
            return next(new CustomError("Token expired", 401));
        }
        
        return next(new CustomError("Token verification failed", 500));
    }
});

export {
    checkAuth, 
    getUserInfo,
    redirectHandler,
    updateFcmToken,
    verifyOAuthToken  // ✅ Export the new verification function
};
