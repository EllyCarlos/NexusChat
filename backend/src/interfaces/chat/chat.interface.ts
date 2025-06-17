import type { IAvatar } from "../auth/auth.interface.js"

// export interface IChat {
//     _id:Types.ObjectId
//     name?:string
//     isGroupChat?:boolean
//     members:Array<Types.ObjectId>
//     avatar?:IAvatar
//     admin?:Types.ObjectId,
//     latestMessage:Types.ObjectId
// }

export interface IMemberDetails {
    _id:string
    username:string
    avatar:IAvatar
    isActive?:boolean
}
