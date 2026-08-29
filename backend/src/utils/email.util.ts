import { config } from "../config/env.config.js";
import { deliverEmail } from "../modules/notifications/email-delivery.service.js";
import { otpVerificationBody, privateKeyRecoveryBody, resetPasswordBody, welcomeEmailBody } from "../constants/emails/email.body.js"
import { otpVerificationSubject, privateKeyRecoverySubject, resetPasswordSubject, welcomeEmailSubject } from "../constants/emails/email.subject.js"
import type { EmailType } from "../interfaces/email/email.interface.js"

export const sendMail = async(
    to: string,
    username: string,
    type: EmailType,
    resetUrl?: string,
    otp?: string,
    verificationUrl?: string
) => {
    let subject: string;
    let htmlContent: string;

    // Get subjects
    switch (type) {
        case 'OTP':
            subject = otpVerificationSubject;
            htmlContent = otpVerificationBody(username, otp!);
            break;
        case 'resetPassword':
            subject = resetPasswordSubject;
            htmlContent = resetPasswordBody(username, resetUrl!);
            break;
        case 'welcome':
            subject = welcomeEmailSubject;
            htmlContent = welcomeEmailBody(username);
            break;
        case 'privateKeyRecovery':
            subject = privateKeyRecoverySubject;
            htmlContent = privateKeyRecoveryBody(username, verificationUrl!);
            break;
        default:
            throw new Error(`Unsupported email type: ${type}`);
    }

    await deliverEmail({
        from: config.email.sender,
        to,
        subject,
        html: htmlContent,
    });
}
