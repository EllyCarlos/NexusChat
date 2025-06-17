export type EmailType =
  | "resetPassword"
  | "OTP"
  | "privateKeyRecovery"
  | "welcome";

type Params = {
  content: string;
  emailType: EmailType;
};

export const emailLayout = ({ content, emailType }: Params) => {
  const headerTitleMap: Record<EmailType, string> = {
    welcome: "Welcome to NexusChat!",
    resetPassword: "Reset Your NexusChat Password",
    privateKeyRecovery: "Verify Private Key Recovery",
    OTP: "Verify Your NexusChat Account",
  };

  const headerTitle = headerTitleMap[emailType] || "NexusChat";

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body {
                font-family: Arial, sans-serif;
                background-color: #f4f4f4;
                margin: 0;
                padding: 0;
            }
            .container {
                background-color: #ffffff;
                max-width: 600px;
                margin: 20px auto;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                line-height: 1.6;
            }
            .header {
                text-align: center;
                border-bottom: 1px solid #dddddd;
                padding-bottom: 10px;
                display: flex;
                align-items: center;
                column-gap: 1rem;
            }
            .header h1 {
                color: #333333;
                font-size: 24px;
                margin: 0;
            }
            .content {
                padding: 20px;
            }
            .content p {
                color: #555555;
            }
            button {
                display: inline-block;
                padding: 10px 20px;
                font-size: 16px;
                background-color: #007bff;
                color: #ffffff;
                text-align: center;
                text-decoration: none;
                border-radius: 5px;
                margin-top: 20px;
                cursor: pointer;
                border: none;
            }
            .footer {
                text-align: center;
                color: #777777;
                font-size: 12px;
                padding-top: 10px;
                border-top: 1px solid #dddddd;
                margin-top: 30px;
            }
            .otp {
                display: inline-block;
                background-color: #f7f7f7;
                padding: 10px 20px;
                font-size: 24px;
                letter-spacing: 5px;
                border-radius: 5px;
                margin: 20px 0;
            }
            a {
                color: #007bff;
            }

            img {
                border-radius: 100%;
                width: 50px;
                height: 50px;
            }
        </style>
    </head>

    <body>
    <div class="container">
        <div class="header">
            <img src="https://res.cloudinary.com/dh5fjdce9/image/upload/v1718195665/logo256_nhwcrt.png" alt="NexusChat Official Logo" />
            <h1>${headerTitle}</h1>
        </div>
        <div class="content">
            ${content}
        </div>
        <div class="footer">
            <p>&copy; 2025 NexusChat. All rights reserved.</p>
        </div>
    </div>
    </body>
    </html>
    `;
};
