import { Server, Socket } from "socket.io";
import { Events } from "../../enums/event/event.enum.js";
import { userSocketIds } from "../../index.js";
import { prisma } from "../../lib/prisma.lib.js";
import { sendPushNotification } from "../../utils/generic.js";

type CallUserEventReceivePayload = {
  calleeId: string;
  offer: RTCSessionDescriptionInit;
};

type IncomingCallEventSendPayload = {
  caller: {
    id:string;
    username:string;
    avatar:string;
  };
  offer: RTCSessionDescriptionInit;
  callHistoryId:string
};

type CallAcceptedEventReceivePayload = {
  callerId: string;
  answer: RTCSessionDescriptionInit;
  callHistoryId:string
};

type CallAcceptedEventSendPayload = {
  calleeId: string;
  answer: RTCSessionDescriptionInit;
  callHistoryId:string
};

type NegoNeededEventReceivePayload = {
  calleeId: string;
  offer: RTCSessionDescriptionInit;
  callHistoryId:string
};

type NegoNeededEventSendPayload = {
  offer: RTCSessionDescriptionInit;
  callerId: string;
  callHistoryId:string
};

type NegoDoneEventReceivePayload = {
  answer: RTCSessionDescriptionInit;
  callerId:string
  callHistoryId:string
};

type NegoFinalEventSendPayload = {
  answer: RTCSessionDescriptionInit;
  calleeId: string;
};

type CallEndEventReceivePayload = {
    callHistoryId:string
    wasCallAccepted:boolean
}

type CallRejectedEventReceivePayload = {
    callHistoryId:string
}

type CalleeBusyEventReceivePayload = {
    callerId:string;
}

type IceCandidateEventReceivePayload = {
    candidate: RTCIceCandidate;
    calleeId:string;
}

type IceCandiateEventSendPayload = {
    candidate: RTCIceCandidate;
    callerId:string;
}

type CallIdEventSendPayload = {
    callHistoryId:string
}


const registerWebRtcHandlers = (socket: Socket,io:Server) => {


    socket.on(Events.CALL_USER,async({calleeId,offer}:CallUserEventReceivePayload)=>{
        try {
            console.log('call user event received from',socket.user.username);
    
            const calleeSocketId = userSocketIds.get(calleeId);
    
            if(!calleeSocketId){
                socket.emit(Events.CALLEE_OFFLINE);
                socket.emit(Events.CALL_END);

                await prisma.callHistory.create({
                    data:{
                        callerId:socket.user.id,
                        calleeId:calleeId,
                        status:"MISSED"
                    }
                })

                const calleeInfo =  await prisma.user.findUnique({
                    where:{id:calleeId},
                    select:{notificationsEnabled:true,fcmToken:true}
                });

                if(calleeInfo && calleeInfo.notificationsEnabled && calleeInfo.fcmToken){
                    sendPushNotification({fcmToken:calleeInfo.fcmToken,body:`You have missed a call from ${socket.user.username}`,title:"Missed Call"})
                }
                console.log('Callee is offline');
                return;
            }
            
            const newCall =  await prisma.callHistory.create({
                data:{
                    callerId:socket.user.id,
                    calleeId:calleeId,
                }
            })
            const payload:IncomingCallEventSendPayload = {
                caller:{
                    id:socket.user.id,
                    username:socket.user.username,
                    avatar:socket.user.avatar
                },
                offer,
                callHistoryId:newCall.id
            }
            
            // sending the callId to the caller as well because if the caller wants to cancel the call he can
            const callIdEventSendPayload:CallIdEventSendPayload = {
                callHistoryId:newCall.id
            }
            socket.emit(Events.CALL_ID,callIdEventSendPayload);

            console.log('emitting incoming call event to',calleeSocketId);
    
            io.to(calleeSocketId).emit(Events.INCOMING_CALL,payload);
            
        } catch (error) {
            console.log('Error in CALL_USER event',error);
            socket.emit(Events.CALL_END);
        }        
    })
    
    socket.on(Events.CALL_ACCEPTED,async({answer,callerId,callHistoryId}:CallAcceptedEventReceivePayload)=>{
        try {
            const callerSocketId = userSocketIds.get(callerId);
            
            if(!callerSocketId){ // caller went offline
                // so we need to update the call status and free both caller and callee from busy list
                const call =  await prisma.callHistory.findUnique({where:{id:callHistoryId}})
                if(!call){
                    console.log('Some Error occured');
                    return;
                }
                await prisma.callHistory.update({
                    where:{id:callHistoryId},
                    data:{
                        status:"MISSED",
                    }
                })

                const calleeSocketId = userSocketIds.get(call.calleeId);
                if(calleeSocketId){
                    io.to(calleeSocketId).emit(Events.CALL_END);
                    io.to(calleeSocketId).emit(Events.CALLER_OFFLINE);
                }
                return;
            }
    
            const payload:CallAcceptedEventSendPayload = {
                calleeId:socket.user.id,
                answer,
                callHistoryId
            }
    
            socket.to(callerSocketId).emit(Events.CALL_ACCEPTED,payload);
            
        } catch (error) {
            console.log('Error in CALL_ACCEPTED event',error);
        }
    })

    socket.on(Events.CALL_REJECTED,async({callHistoryId}:CallRejectedEventReceivePayload)=>{

        const call =  await prisma.callHistory.findUnique({
            where:{id:callHistoryId}
        })
        try {
            if(!call){
                console.log(`Call not found for callHistoryId: ${callHistoryId}`);
                return;
            }
    
            const updatedCall = await prisma.callHistory.update({
                where:{id:call.id},
                data:{status:"REJECTED"}
            })
            
            
            const callerSocketId = userSocketIds.get(updatedCall.callerId);
            const calleeSocketId = userSocketIds.get(updatedCall.calleeId);
            
            if(callerSocketId){
                socket.to(callerSocketId).emit(Events.CALL_REJECTED);
                socket.to(callerSocketId).emit(Events.CALL_END);
            }

            if(calleeSocketId){
                io.to(calleeSocketId).emit(Events.CALL_END);
            }

        } catch (error) {
            console.log('Error in CALL_REJECTED event',error);
        }
    })
    
    socket.on(Events.CALL_END,async({callHistoryId,wasCallAccepted}:CallEndEventReceivePayload)=>{

        try {
            const ongoingCall = await prisma.callHistory.findUnique({where: {id:callHistoryId}});
    
            if(!ongoingCall){
                console.log(`Ongoing call not found for callHistoryId: ${callHistoryId}`);
                return;
            }
    
            await prisma.callHistory.update({
                where:{id:ongoingCall.id},
                data:{
                    endedAt:new Date(),
                    duration: Math.floor((new Date().getTime() - ongoingCall.startedAt.getTime()) / 1000), 
                    status: !wasCallAccepted ? "MISSED" : "COMPLETED"
                }
            })
    
            const callerSocketId = userSocketIds.get(ongoingCall.callerId);
            const calleeSocketId = userSocketIds.get(ongoingCall.calleeId);
        
            if(callerSocketId){
                io.to(callerSocketId).emit(Events.CALL_END);
            }
            if(calleeSocketId){
                io.to(calleeSocketId).emit(Events.CALL_END);
            }
            
        } catch (error) {
            console.error(`Error in CALL_END event for callHistoryId: ${callHistoryId}`, error);
        }
    })

    socket.on(Events.CALLEE_BUSY,({callerId}:CalleeBusyEventReceivePayload)=>{
        const callerSocketId = userSocketIds.get(callerId);
        if(callerSocketId){
            socket.to(callerSocketId).emit(Events.CALLEE_BUSY);
            socket.to(callerSocketId).emit(Events.CALL_END);
        }
    })
    
    socket.on(Events.ICE_CANDIDATE,async({candidate,calleeId}:IceCandidateEventReceivePayload)=>{
        console.log('ice candiate receive from ',socket.user.username);
        const calleeSocketId = userSocketIds.get(calleeId);
        if(!calleeSocketId){
            console.log('Callee is offline during ice candidate exchange');
            return;
        }

        const payload:IceCandiateEventSendPayload = {
            callerId:socket.user.id,
            candidate
        }
        io.to(calleeSocketId).emit(Events.ICE_CANDIDATE,payload);
    })

    socket.on(Events.NEGO_NEEDED,async({offer,calleeId,callHistoryId}:NegoNeededEventReceivePayload)=>{

        try {
            const calleeSocketId = userSocketIds.get(calleeId);
            
            if(!calleeSocketId){
                // so we need to update the call status and free both caller and callee from busy list
                const call =  await prisma.callHistory.findUnique({where:{id:callHistoryId}})
                if(!call){
                    console.error(`Call history not found for callHistoryId: ${callHistoryId}`);
                    return;
                }
                await prisma.$transaction([
                    prisma.callHistory.update({
                        where: { id: callHistoryId },
                        data: { status: "MISSED" }
                    })
                ]);
                
                
                const callerSocketId = userSocketIds.get(call.callerId);
                if(callerSocketId){
                    io.to(callerSocketId).emit(Events.CALLEE_OFFLINE);
                    io.to(callerSocketId).emit(Events.CALL_END);
                }
                return;
            }

            const payload:NegoNeededEventSendPayload = {
                offer,
                callerId:socket.user.id,
                callHistoryId
            }
            socket.to(calleeSocketId).emit(Events.NEGO_NEEDED,payload);        
            
        } catch (error) {
            console.log('Error in NEGO_NEEDED event',error);
        }
    })
    
    socket.on(Events.NEGO_DONE,async({answer,callerId,callHistoryId}:NegoDoneEventReceivePayload)=>{
        try {
            const callerSocketId = userSocketIds.get(callerId);
            
            if(!callerSocketId){
                // so we need to update the call status and free both caller and callee from busy list
                const call =  await prisma.callHistory.findUnique({where:{id:callHistoryId}})
                if(!call){
                    console.warn(`Call history not found or already updated for callHistoryId: ${callHistoryId}`);
                    return;
                }
                await prisma.$transaction([
                    prisma.callHistory.update({
                        where: { id: callHistoryId },
                        data: { status: "MISSED" }
                    })
                ]);
                
                
                const calleeSocketId = userSocketIds.get(call.calleeId);
                
                if(calleeSocketId){
                    io.to(calleeSocketId).emit(Events.CALL_END);
                    io.to(calleeSocketId).emit(Events.CALLER_OFFLINE);
                }
                return;
            }
    
            const payload:NegoFinalEventSendPayload = {
                answer,
                calleeId:socket.user.id
            }
    
            socket.to(callerSocketId).emit(Events.NEGO_FINAL,payload)
        } catch (error) {
            console.log('Error in NEGO_DONE event',error);
        }
    })
};

export default registerWebRtcHandlers;
