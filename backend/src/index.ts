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


// environment variables validation
checkEnvVariables();

const app=express()
const server=createServer(app)
const io = new Server(server, {
    cors: {
        credentials: true,
        origin: process.env.NODE_ENV === 'PRODUCTION' 
            ? [config.clientUrl, process.env.VERCEL_URL].filter(Boolean)
            : [config.clientUrl, 'http://localhost:3000']
    }
})

// global
app.set("io",io)

// userSocketIds
export const userSocketIds = new Map<string,string>()

// middlewares
app.use(cors({
    credentials: true,
    origin: process.env.NODE_ENV === 'PRODUCTION' 
        ? [config.clientUrl, process.env.VERCEL_URL].filter(Boolean)
        : [config.clientUrl, 'http://localhost:3000']
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
});    // Graceful shutdown handling
const gracefulShutdown = () => {
    console.log('Received shutdown signal, closing server gracefully...');
    server.close(() => {
        console.log('HTTP server closed');
        // Close database connections if any
        process.exit(0);
    });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
