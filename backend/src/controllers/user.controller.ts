
import { prisma } from "../lib/prisma.lib.js";
import { deleteFilesFromCloudinary, uploadFilesToCloudinary } from "../utils/auth.util.js";
import { sendMail } from "../utils/email.util.js";
import { CustomError, asyncErrorHandler } from "../utils/error.utils.js";
import { signPasswordResetToken } from "../utils/jwt.utils.js";
import { logServerError } from "../utils/safe-logger.utils.js";
import { cleanupTemporaryFiles } from "../utils/upload-lifecycle.util.js";

// Get base URL from environment variables
const getBaseUrl = () => {
    return process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://nexuswebapp.vercel.app';
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

    const existingAvatarPublicId = req.user.avatarCloudinaryPublicId;
    let uploadedPublicId: string | null = null;
    let avatarCommitted = false;

    try {
        const [uploadedAvatar] = await uploadFilesToCloudinary({ files: [req.file] });
        if (!uploadedAvatar) {
            throw new Error("Avatar upload returned no result");
        }
        uploadedPublicId = uploadedAvatar.public_id;

        const user = await prisma.user.update({
            where: {
                id: req.user.id
            },
            data: {
                avatar: uploadedAvatar.secure_url,
                avatarCloudinaryPublicId: uploadedAvatar.public_id
            }
        });
        avatarCommitted = true;

        if (existingAvatarPublicId && existingAvatarPublicId !== uploadedAvatar.public_id) {
            try {
                await deleteFilesFromCloudinary({ publicIds: [existingAvatarPublicId] });
            } catch (cleanupError) {
                logServerError('Previous avatar cleanup failed.', cleanupError);
            }
        }

        const secureUserInfo = {
            id: user.id,
            name: user.name,
            username: user.username,
            avatar: user.avatar,
            email: user.email,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            emailVerified: user.emailVerified,
            publicKey: user.publicKey,
            notificationsEnabled: user.notificationsEnabled,
            verificationBadge: user.verificationBadge,
            fcmToken: user.fcmToken,
            oAuthSignup: user.oAuthSignup
        };

        return res.status(200).json(secureUserInfo);

    } catch (error) {
        if (!avatarCommitted && uploadedPublicId) {
            try {
                await deleteFilesFromCloudinary({ publicIds: [uploadedPublicId] });
            } catch (cleanupError) {
                logServerError('Uploaded-file cleanup failed.', cleanupError);
            }
        }
        return next(new CustomError("Failed to update user profile", 500));
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
        logServerError('Email sending failed.', error);
        return next(new CustomError(`Failed to send ${emailType} email`, 500));
    }
});
