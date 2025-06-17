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

export const socketAuthenticatorMiddleware = async(socket:Socket,next:NextFunction)=>{

    try {
            const token = socket.handshake.query.token as string;

            if (!token) {
                return next(new CustomError("Token missing, please login again", 401));
            } 

            const secret = 'helloWorld@123'
            const decodedInfo=jwt.verify(token,secret,{algorithms:["HS256"]}) as SessionPayload;
        
            if(!decodedInfo || !decodedInfo.userId){
                return next(new CustomError("Invalid token please login again",401))
            }
        
            const existingUser = await prisma.user.findUnique({where:{id:decodedInfo.userId}})
        
            if(!existingUser){
                return next(new CustomError('Invalid Token, please login again',401))
            }
        
            socket.user=existingUser
            next()
        }
        
    catch (error) {
        console.log(error);
        return next(new CustomError("Invalid Token, please login again", 401))
    }

}