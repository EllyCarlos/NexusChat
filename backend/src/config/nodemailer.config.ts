import nodemailer from 'nodemailer'
import { env } from '../schemas/env.schema.js'
import { logServerError } from '../utils/safe-logger.utils.js'

let transporter : nodemailer.Transporter

try {
    transporter = nodemailer.createTransport({
        service:"gmail",
        auth:{
            user:env.EMAIL,
            pass:env.PASSWORD
        }
    })
} catch (error) {
    logServerError('Email transporter initialization failed.', error);
}

export {
    transporter
}

