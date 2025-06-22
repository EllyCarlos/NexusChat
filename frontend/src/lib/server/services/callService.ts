import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";

// prisma query function
export const fetchUserCallHistory = async({loggedInUserId}:{loggedInUserId:string})=>{

    const callHistory = await prisma.callHistory.findMany({
        where:{
            OR:[
                {callerId:loggedInUserId},
                {calleeId:loggedInUserId}
            ]
        },
        include:{
            callee:{
                select:{
                    id:true,
                    username:true,
                    avatar:true,
                    verificationBadge:true,
                }
            },
            caller:{
                select:{
                    id:true,
                    username:true,
                    avatar:true,
                    verificationBadge:true,
                }
            }
        },
        omit:{
            callerId:true,
            calleeId:true,
        },
        orderBy:{
            startedAt:"desc"
        },
        take:40,
    })

    return callHistory;
}


// types
export type fetchUserCallHistoryResponse = Prisma.CallHistoryGetPayload<{
    include:{
        callee:{
            select:{
                id:true,
                username:true,
                avatar:true,
                verificationBadge:true,
            }
        },
        caller:{
            select:{
                id:true,
                username:true,
                avatar:true,
                verificationBadge:true,
            }
        }
    },
    omit:{
        callerId:true,
        calleeId:true,
    },
}>