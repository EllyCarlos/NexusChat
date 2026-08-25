import nodemailer from "nodemailer";

let transporter: nodemailer.Transporter | null = null;

export const getTransporter = () => {
  if (!transporter) {
    const email = process.env.EMAIL;
    const password = process.env.PASSWORD;

    if (!email || !password) {
      throw new Error("EMAIL and PASSWORD are required to send email");
    }

    try {
      transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: email,
          pass: password,
        },
      });
    } catch {
      console.error("Failed to initialize the email transporter.");
      throw new Error("Failed to initialize email transporter");
    }
  }
  return transporter;
};
