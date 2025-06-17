import { ChatMember } from "@/lib/server/services/userService"

export interface UserTypingEventReceiveData {
    chatId:string
    user:ChatMember
}

export interface NewMemberAddedEventPayloadData {
    chatId:string,
    members:ChatMember[]
}

export interface DeleteChatEventReceiveData {
    chatId:string
}
export interface MemberRemovedEventReceiveData extends DeleteChatEventReceiveData {
    membersId:string[]
}