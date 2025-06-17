import { getTransporter } from "../nodemailer";
import { emailLayout, EmailType } from "./EmaiLayout";
import { otpVerificationEmailContent, otpVerificationEmailSubject } from "./templates/OtpVerificationEmail";
import { privateKeyRecoveryEmailContent, privateKeyRecoveryEmailSubject } from "./templates/PrivateKeyRecoveryEmail";
import { resetPasswordEmailContent, resetPasswordEmailSubject } from "./templates/ResetPasswordEmail";
import { welcomeEmailContent, welcomeEmailSubject } from "./templates/WelcomeEmail";

type Params = {
    to: string,
    username: string,
    emailType: EmailType,
    resetPasswordUrl?: string,
    otp?: string,
    verificationUrl?: string
}

export const sendEmail = async ({to,emailType,username,otp,resetPasswordUrl,verificationUrl}:Params) => {

  const transporter = getTransporter();
  if (!transporter) throw new Error("Failed to initialize email transporter");

  let content = "";
  let subject = "NexusChat Notification";

  switch (emailType) {
    case "OTP":
      subject = otpVerificationEmailSubject;
      content = otpVerificationEmailContent({otp:otp as string,username})
      break;
    case "resetPassword":
      subject = resetPasswordEmailSubject;
      content = resetPasswordEmailContent({resetUrl:resetPasswordUrl as string,username})
      break;
    case "privateKeyRecovery":
      subject = privateKeyRecoveryEmailSubject;
      content = privateKeyRecoveryEmailContent({username,verificationUrl:verificationUrl as string})
      break;
    case "welcome":
      subject = welcomeEmailSubject;
      content = welcomeEmailContent({username})
      break;
    default:
      throw new Error("Invalid email type.");
  }

  await transporter.sendMail({
    from: process.env.EMAIL,
    to,
    subject,
    html: emailLayout({ content, emailType }),
  });
};
