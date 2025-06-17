import { IMemberDetails } from "../chat/chat.interface.js"

export interface IAttachment {
    secureUrl:string,
    publicId:string
}

export interface IMessage {
    id:string
    content?:string
    sender:string
    chat:string
    url?:string
    attachments?:Array<IAttachment>
    isPoll?:boolean
    pollQuestion?:string
    pollOptions?:[]
    reactions?:Array<{user:string,emoji:string}>
    isMultipleAnswers?:boolean
    isEdited?:boolean
    createdAt:Date
    updatedAt:Date
}

export interface IMessageEventPayload {

    _id: string,
    content?: string,
    sender: {
        _id: string,
        avatar: string,
        username: string
    },
    chat: string,
    url?:string,
    attachments?:Array<IAttachment['secureUrl']>,
    isPoll?:boolean
    pollQuestion?:string
    pollOptions?:Array<{option:string,votes:Array<IMemberDetails>}>
    createdAt: Date,
    updatedAt:  Date
    reactions:[]
}

export interface INewReactionEventPayloadData {
    chatId:string
    messageId:string
    user:{_id:string,username:string,avatar:string}
    emoji:string
}

export interface IDeleteReactionEventPayloadData {
    chatId:string
    messageId:string
    userId:string
}