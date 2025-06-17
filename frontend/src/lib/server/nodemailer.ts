import nodemailer from "nodemailer";

let transporter: nodemailer.Transporter | null = null;

export const getTransporter = () => {
  if (!transporter) {
    try {
      transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.EMAIL,
          pass: process.env.PASSWORD,
        },
      });
    } catch (error) {
      console.error("Error initializing Nodemailer transporter:", error);
      throw new Error("Failed to initialize email transporter");
    }
  }
  return transporter;
};