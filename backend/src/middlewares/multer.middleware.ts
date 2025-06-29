import multer from 'multer'
import { MAX_FILE_SIZE } from '../constants/file.constant.js'
import type { AuthenticatedRequest } from '../interfaces/auth/auth.interface.js'
import {v4 as uuidV4 } from 'uuid'

export const upload = multer({
    limits:{fileSize:MAX_FILE_SIZE},

    storage:multer.diskStorage({
        filename:(req:AuthenticatedRequest,file,cb)=>{
            const userId=req.user.id
            const uniqueMiddleName = uuidV4()
            const newFileName = `${userId}-${uniqueMiddleName}-${file.originalname}`
            cb(null,newFileName)
        }
        
    })
})

