type Params = {
  username: string;
  verificationUrl: string;
};

const privateKeyRecoveryEmailContent = ({
  username,
  verificationUrl,
}: Params) => `
      <p>Hello ${username},</p>
      <p>We received a request to recover the private key associated with your NexusChat account. For security reasons, this request must be verified.</p>
      <p>If you initiated this request, please confirm it by clicking the button below:</p>
      <p style="text-align: center;">
          <a href="${verificationUrl}" style="text-decoration: none;">
              <button>
                  Verify Private Key Recovery
              </button>
          </a>
      </p>
      <p>If the button above does not work, you can also verify your request by copying and pasting the following link into your browser:</p>
      <p><a href="${verificationUrl}">${verificationUrl}</a></p>
      <p><strong>For security reasons, this link will expire in 5 minutes.</strong></p>
      <p>If you did not request this recovery, please ignore this email. Your account remains secure.</p>
      <p>Do not share this email with anyone to protect your account.</p>
      <p>Best regards,</p>
      <p><strong>NexusChat Support Team</strong></p>
  `;

const privateKeyRecoveryEmailSubject =
  "Action Required: Verify Your Request to Recover Private Key";

export { privateKeyRecoveryEmailContent, privateKeyRecoveryEmailSubject };
