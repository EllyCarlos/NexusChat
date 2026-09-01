
import { config } from "../config/env.config.js";
import { updateUserAvatar } from "../modules/users/profile.service.js";
import { sendMail } from "../utils/email.util.js";
import { CustomError, asyncErrorHandler } from "../utils/error.utils.js";
import { signPasswordResetToken } from "../modules/auth/token/session-token.service.js";
import { getRequestLogger } from "../observability/request-logger.js";
import { logSafeError } from "../observability/safe-error.js";
import { cleanupTemporaryFiles } from "../utils/upload-lifecycle.util.js";

const getBaseUrl = () => {
    return config.app.frontendUrl;
};

// Generate password reset token
const generateResetToken = (userId: string) => {
    return signPasswordResetToken({
        userId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });
};

export const updateUser = asyncErrorHandler(async (req, res, next) => {
    if (!req.file) {
        return next(new CustomError("Please provide an image", 400));
    }

    try {
        const user = await updateUserAvatar({
            userId: req.user.id,
            existingAvatarPublicId: req.user.avatarCloudinaryPublicId,
            upload: {
                path: req.file.path,
            },
        });
        return res.status(200).json(user);
    } finally {
        await cleanupTemporaryFiles([req.file]);
    }
});
export const testEmailHandler = asyncErrorHandler(async (req, res, next) => {
    const { emailType } = req.query;
    const baseUrl = getBaseUrl();
    
    const validEmailTypes = ['welcome', 'resetPassword', 'otpVerification', 'privateKeyRecovery'];
    
    if (!emailType || !validEmailTypes.includes(emailType)) {
        return next(new CustomError(`Invalid email type. Supported types: ${validEmailTypes.join(', ')}`, 400));
    }

    try {
        switch (emailType) {
            case 'welcome':
                await sendMail(
                    req.user.email, 
                    req.user.username, 
                    'welcome'
                );
                break;

            case 'resetPassword':
                // Generate a test reset token
                const resetToken = generateResetToken(req.user.id);
                const resetUrl = `${baseUrl}/auth/reset-password?token=${resetToken}`;
                
                await sendMail(
                    req.user.email, 
                    req.user.username, 
                    'resetPassword',
                    resetUrl // Pass the complete reset URL
                );
                break;

            case 'otpVerification':
                await sendMail(
                    req.user.email, 
                    req.user.username, 
                    'OTP',
                    undefined, // resetUrl
                    "3412" // otp
                );
                break;

            case 'privateKeyRecovery':
                const verificationUrl = `${baseUrl}/auth/recover-private-key`;
                await sendMail(
                    req.user.email, 
                    req.user.username, 
                    'privateKeyRecovery',
                    undefined, // resetUrl
                    undefined, // otp
                    verificationUrl // verificationUrl
                );
                break;

            default:
                return next(new CustomError('Unsupported email type', 400));
        }

        return res.status(200).json({ 
            message: `${emailType} email sent successfully`,
            recipient: req.user.email,
            baseUrl: baseUrl // For debugging
        });

    } catch (error) {
        logSafeError(
            getRequestLogger(req, "notification"),
            "notification.email_send.failed",
            error,
        );
        return next(new CustomError(`Failed to send ${emailType} email`, 500));
    }
});
