import { NextFunction, Request, Response } from "express";
import jwt from 'jsonwebtoken';
import { v4 as uuidV4 } from 'uuid'; // Added for JTI
import { config } from "../config/env.config.js";
import type { AuthenticatedRequest, OAuthAuthenticatedRequest } from "../interfaces/auth/auth.interface.js";
import { prisma } from '../lib/prisma.lib.js';
import type { fcmTokenSchemaType } from "../schemas/auth.schema.js";
import { env } from "../schemas/env.schema.js";
import { CustomError, asyncErrorHandler } from "../utils/error.utils.js";

// Cookie configuration utility
const setAuthCookie = (res: Response, token: string) => {
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie('sessionToken', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    domain: isProduction ? config.cookieDomain : undefined,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
    partitioned: true // For Chrome's new cookie partitioning
  });
};

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
                userEmail: req.user.email
            });

            const tempToken = jwt.sign({
                userId: req.user.id,
                type: req.user.newUser ? 'new' : 'existing',
                isNewUser: req.user.newUser,
                iat: Math.floor(Date.now() / 1000)
            }, env.JWT_SECRET, {expiresIn:"5m"});

            console.log('Generated OAuth token payload:', {
                userId: req.user.id,
                type: req.user.newUser ? 'new' : 'existing',
                isNewUser: req.user.newUser
            });

            return res.redirect(307, `${config.clientUrl}/auth/oauth-redirect?token=${tempToken}`);
        }
        return res.redirect(`${config.clientUrl}/auth/login`);
    } catch (error) {
        console.error('Error during oauth redirect handler:', error);
        return res.redirect(`${config.clientUrl}/auth/login?error=${encodeURIComponent('OAuth processing failed')}`);
    }
})

const generateSessionToken = (userId: string) => {
  return jwt.sign({
    userId: userId,
    type: 'session',
    iat: Math.floor(Date.now() / 1000),
    iss: config.jwtIssuer,
    aud: config.jwtAudience,
    jti: uuidV4()
  }, env.JWT_SECRET, {
    expiresIn: "7d",
    algorithm: 'HS256'
  });
};

const verifyOAuthToken = asyncErrorHandler(async(req: Request, res: Response, next: NextFunction) => {
    try {
        const { token } = req.body;
        
        if (!token) {
            return next(new CustomError("Token is required", 400));
        }

        const decoded = jwt.verify(token, env.JWT_SECRET) as any;
           
        if (!decoded.userId || typeof decoded.isNewUser !== 'boolean') {
            return next(new CustomError("Invalid token structure", 401));
        }

        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
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
                notificationsEnabled: true,
                verificationBadge: true,
                fcmToken: true,
                oAuthSignup: true
            }
        });

        if (!user) {
            return next(new CustomError("User not found", 404));
        }

        const sessionToken = generateSessionToken(user.id);
        setAuthCookie(res, sessionToken);

        const responseData: any = {
            user,
            sessionToken
        };

        if (decoded.isNewUser) {
            responseData.combinedSecret = `${user.id}_${user.email}_${Date.now()}`;
        }

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

const logoutHandler = asyncErrorHandler(async(req: AuthenticatedRequest, res: Response) => {
  res.clearCookie('sessionToken', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    domain: process.env.NODE_ENV === 'production' ? config.cookieDomain : undefined
  });

  return res.status(200).json({ 
    success: true,
    message: 'Logged out successfully' 
  });
});

export {
    checkAuth, 
    getUserInfo,
    redirectHandler,
    updateFcmToken,
    verifyOAuthToken,
    logoutHandler,
    generateSessionToken
};