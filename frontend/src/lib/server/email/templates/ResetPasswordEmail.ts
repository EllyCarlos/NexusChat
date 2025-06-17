type Params = {
  username: string;
  resetUrl: string;
};

const resetPasswordEmailContent = ({ resetUrl, username }: Params) => `
    <p>Hi ${username},</p>
    <p>We received a request to reset your password for your NexusChat account.</p>
    <p>To create a new password, click the button below:</p>
    <p style="text-align: center;">
        <a href="${resetUrl}" style="text-decoration: none;">
            <button>
                Reset Password
            </button>
        </a>
    </p>
    <p>If the button above does not work, you can also reset your password by copying and pasting the following link into your browser:</p>
    <p><a href="${resetUrl}">${resetUrl}</a></p>
    <p><strong>For security reasons, this link will expire in 24 hours.</strong></p>
    <p>If you did not request this password reset, you can safely ignore this email.</p>
    <p>If you continue to have trouble accessing your account, please contact our support team at 
        <a href="mailto:NexusChat.online@gmail.com">NexusChat.online@gmail.com</a>.
    </p>
    <p><strong>Do not share this email with anyone.</strong></p>
    <p>Thanks,</p>
    <p><strong>The NexusChat Team</strong></p>
    <p>Stay safe!</p>
`;

const resetPasswordEmailSubject = "Reset Your Password for NexusChat";

export { resetPasswordEmailContent, resetPasswordEmailSubject };
