import cookieParser from 'cookie-parser'
import cors from 'cors'
import express, { Request, Response } from 'express'
import { createServer } from 'http'
import morgan from 'morgan'
import passport from 'passport'
import { Server } from 'socket.io'
import './config/cloudinary.config.js'
import { config } from './config/env.config.js'
import { errorMiddleware } from './middlewares/error.middleware.js'
import './passport/google.strategy.js'
import { checkEnvVariables, env } from './schemas/env.schema.js'

import attachmentRoutes from './routes/attachment.router.js'
import authRoutes from './routes/auth.router.js'
import chatRoutes from './routes/chat.router.js'
import messageRoutes from './routes/message.router.js'
import requestRoutes from './routes/request.router.js'
import userRoutes from './routes/user.router.js'

import { socketAuthenticatorMiddleware } from './middlewares/socket-auth.middleware.js'
import registerSocketHandlers from './socket/socket.js'
import { prisma } from './lib/prisma.lib.js'

// environment variables validation
checkEnvVariables();
// Create CORS origins array
const corsOrigins = process.env.NODE_ENV === 'PRODUCTION' 
    ? [config.clientUrl, process.env.VERCEL_URL].filter((url): url is string => Boolean(url))
    : [config.clientUrl, 'http://localhost:3000'];

const app=express()
const server=createServer(app)
const io = new Server(server, {
    cors: {
        credentials: true,
        origin: corsOrigins
    }
})
// global
app.set("io",io)

// userSocketIds
export const userSocketIds = new Map<string,string>()

// middlewares
app.use(cors({
    credentials: true,
    origin: corsOrigins
}))
app.use(passport.initialize())
app.use(express.json())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
app.use(cookieParser())
app.use(morgan('tiny'))


// route middlewares
app.use("/api/v1/auth",authRoutes)
app.use("/api/v1/chat",chatRoutes)
app.use("/api/v1/user",userRoutes)
app.use("/api/v1/request",requestRoutes)
app.use("/api/v1/message",messageRoutes)
app.use("/api/v1/attachment",attachmentRoutes)

io.use(socketAuthenticatorMiddleware)


app.get("/", (_: Request, res: Response) => {
    res.status(200).json({
        status: 'OK',
        running: true,
        timestamp: new Date().toISOString(),
        environment: env.NODE_ENV,
        uptime: Math.floor(process.uptime()),
        connectedClients: io.engine.clientsCount
    })
})

// Add dedicated health check
app.get("/health", (_: Request, res: Response) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
            server: 'running',
            socket: `${io.engine.clientsCount} clients connected`,
            memory: {
                used: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100 + ' MB',
                total: Math.round((process.memoryUsage().heapTotal / 1024 / 1024) * 100) / 100 + ' MB'
            }
        }
    })
})
// error middleware
app.use(errorMiddleware)

// Register Socket.IO event handlers
registerSocketHandlers(io);
// Socket connection management
io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);
    
    socket.on('disconnect', (reason) => {
        console.log(`Client disconnected: ${socket.id}, reason: ${reason}`);
        
        // Clean up userSocketIds mapping
        for (const [userId, socketId] of userSocketIds.entries()) {
            if (socketId === socket.id) {
                userSocketIds.delete(userId);
                console.log(`Removed user ${userId} from socket mapping`);
                break;
            }
        }
    });
});

server.listen(env.PORT, () => {
    const baseUrl = env.NODE_ENV === 'PRODUCTION' 
        ? `https://nexuschat-4slv.onrender.com` 
        : `http://localhost:${env.PORT}`;
    
    console.log(`🚀 Server [STARTED] ~ ${baseUrl}`);
    console.log(`📊 Environment: ${env.NODE_ENV}`);
    console.log(`🌐 CORS Origin: ${config.clientUrl}`);
    console.log(`⚡ Socket.IO enabled with authentication`);
    
    if (env.NODE_ENV === 'PRODUCTION') {
        console.log('🔒 Production mode - Security measures active');
    } else {
        console.log('🛠️  Development mode');
    }
});   
// Graceful shutdown handler
const gracefulShutdown = async () => {
  console.log('Received shutdown signal, closing database connections...')
  try {
    await prisma.$disconnect()
    console.log('Database connections closed successfully')
    process.exit(0)
  } catch (error) {
    console.error('Error during graceful shutdown:', error)
    process.exit(1)
  }
}

// Handle various shutdown signals
process.on('SIGTERM', gracefulShutdown)
process.on('SIGINT', gracefulShutdown)
process.on('beforeExit', gracefulShutdown)

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
  gracefulShutdown()
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
  gracefulShutdown()
})