import type { NextFunction, Request, Response } from 'express'
import type { AuthenticatedRequest } from '../interfaces/auth/auth.interface.js'

export { ApplicationError, CustomError } from '../errors/application-error.js'

export const asyncErrorHandler = (func:(req:Request | AuthenticatedRequest | any ,res:Response,next:NextFunction)=>Promise<void | Response>) => async(req:Request,res:Response,next:NextFunction)=>{
    try {
        await func(req,res,next)
    } catch (error) {
        next(error)
    }
}
