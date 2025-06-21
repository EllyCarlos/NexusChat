
import { prisma } from "../lib/prisma.lib.js";
import { deleteFilesFromCloudinary, uploadFilesToCloudinary } from "../utils/auth.util.js";
import { sendMail } from "../utils/email.util.js";
import { CustomError, asyncErrorHandler } from "../utils/error.utils.js";
import jwt from 'jsonwebtoken';

// Get base URL from environment variables
const getBaseUrl = () => {
    return process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://nexuswebapp.vercel.app';
};

// Generate password reset token
const generateResetToken = (userId: string) => {
    return jwt.sign(
        { 
            userId,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
        },
        process.env.JWT_SECRET || 'your-secret-key',
        { 
            expiresIn: '24h' 
        }
    );
};

export const updateUser = asyncErrorHandler(async (req, res, next) => {
    if (!req.file) {
        return next(new CustomError("Please provide an image", 400));
    }

    let uploadResults;
    const existingAvatarPublicId = req.user.avatarCloudinaryPublicId;

    try {
        if (!existingAvatarPublicId) {
            uploadResults = await uploadFilesToCloudinary({ files: [req.file] });
            if (!uploadResults || uploadResults.length === 0) {
                return next(new CustomError("Failed to upload image", 500));
            }
        } else {
            const cloudinaryFilePromises = [
                deleteFilesFromCloudinary({ publicIds: [existingAvatarPublicId] }),
                uploadFilesToCloudinary({ files: [req.file] })
            ];
            
            const [_, result] = await Promise.all(cloudinaryFilePromises);
            
            if (!result || result.length === 0) {
                return next(new CustomError("Failed to update image", 500));
            }
            
            uploadResults = result;
        }

        const user = await prisma.user.update({
            where: {
                id: req.user.id
            },
            data: {
                avatar: uploadResults[0].secure_url,
                avatarCloudinaryPublicId: uploadResults[0].public_id
            }
        });

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
        if (uploadResults && uploadResults[0]) {
            try {
                await deleteFilesFromCloudinary({ publicIds: [uploadResults[0].public_id] });
            } catch (cleanupError) {
                console.error('Failed to cleanup uploaded file:', cleanupError);
            }
        }
        
        return next(new CustomError("Failed to update user profile", 500));
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
        console.error(`Email sending error:`, error);
        return next(new CustomError(`Failed to send ${emailType} email`, 500));
    }
});

// Function to handle actual password reset requests
export const requestPasswordReset = asyncErrorHandler(async (req, res, next) => {
    const { email } = req.body;
    
    if (!email) {
        return next(new CustomError("Email is required", 400));
    }

    try {
        const user = await prisma.user.findUnique({
            where: { email }
        });

        // Always return success to prevent email enumeration attacks
        const baseUrl = getBaseUrl();
        
        if (user) {
            const resetToken = generateResetToken(user.id);
            const resetUrl = `${baseUrl}/auth/reset-password?token=${resetToken}`;
            
            // Store reset token in database (optional but recommended)
           // Delete any existing reset tokens for this user
await prisma.resetPasswordToken.deleteMany({
    where: { userId: user.id }
});

// Create a new reset token
await prisma.resetPasswordToken.create({
    data: {
        userId: user.id,
        hashedToken: resetToken, // Consider hashing this for security
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
    }
});            
            await sendMail(
                email, 
                user.username, 
                'resetPassword',
                resetUrl
            );
        }

        return res.status(200).json({ 
            message: "If your email is registered with us, you'll receive a password reset link shortly." 
        });

    } catch (error) {
        console.error('Password reset request error:', error);
        return next(new CustomError("Failed to process password reset request", 500));
    }
});
