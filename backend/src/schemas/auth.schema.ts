import { z } from "zod";

const passwordValidation = z.string({required_error:"Password is required"}).min(8,'Password cannot be shorter than 8 characters').max(40,'Password cannot be longer than 30 characters')
.regex(/^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[a-zA-Z]).{8,}$/gm,'Password must contain 8 characters, 1 uppercase letter, 1 lowercase letter and 1 number')


export const fcmTokenSchema = z.object({
    fcmToken:z.string({required_error:"fcm token is required"})
})

export type fcmTokenSchemaType = z.infer<typeof fcmTokenSchema>
