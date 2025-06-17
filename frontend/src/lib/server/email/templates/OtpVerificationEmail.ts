type Params = {
  username: string;
  otp: string;
};

const otpVerificationEmailSubject = "Verify Your Email Address for NexusChat";

const otpVerificationEmailContent = ({ otp, username }: Params) => `
  <p>Hi ${username},</p>
  <p>To keep your account secure, we need to verify your identity.</p>
  <p>Your one-time verification code (OTP) is:</p>
  <p class='otp'>${otp}</p>
  <p>This code is valid for <strong>5 minutes</strong>. Please enter it on the verification page to proceed.</p>
  <p>If you didn't request this, no action is needed. Your account remains secure.</p>
  <p>For your safety, never share this code with anyone.</p>
  <p>Best regards,</p>
  <p><strong>The NexusChat Team</strong></p>
`;

export { otpVerificationEmailContent, otpVerificationEmailSubject };
