NexusChat - Real-time Secure Messaging Application
🚀 Overview

NexusChat is a modern, full-stack real-time messaging application designed for secure and efficient communication. It offers a rich set of features, from one-on-one chats and group conversations to voice notes, file sharing, and real-time calling, all powered by a robust backend and a dynamic frontend.
✨ Features

    Real-time Messaging: Instant message delivery and presence indication.

    One-on-One Chats: Private and secure direct messaging.

    Group Chats: Create and manage group conversations.

    Voice Notes: Send and receive audio messages.

    File Sharing: Share images, documents, and other file attachments.

    Real-time Calling: Conduct voice and video calls within the application.

    User Authentication: Secure sign-up, login, and password management (including recovery).

    Google OAuth: Seamless social login integration.

    Push Notifications: Stay updated with new messages and calls.

    Interactive Media: Integrated Emoji and GIF pickers for richer conversations.

    Polls: Create and participate in polls within chats.

    Responsive UI: Beautiful and adaptive design using Tailwind CSS.

    End-to-End Encryption (Conceptual): Designed with principles to support secure communication (implementation details would be further specified within the code).

🛠️ Tech Stack
Frontend

    ⚛️ Next.js 15 + React 19: Modern full-stack React framework for building fast and scalable web applications.

    🛠️ Redux Toolkit + React-Redux: Efficient global state management for a consistent user experience.

    🔗 React Hook Form + Zod: Robust form handling and schema validation for reliable data input.

    🔄 Socket.IO Client: Enables real-time, bidirectional communication with the backend for live updates.

    📅 Date-fns: Lightweight utility library for date and time manipulation.

    🎥 Framer Motion + Lottie-React: For fluid animations and dynamic UI effects.

    🔥 Firebase: Used for push notifications integration on the frontend.

    💅 Tailwind CSS: A utility-first CSS framework for rapid and responsive UI development.

    💬 Emoji-Picker-React + Gif-Picker-React: Enhances chat interactivity with rich media options.

Backend

    🟢 Node.js + Express: A scalable and performant backend API server.

    🔄 Socket.IO: Facilitates real-time, event-driven communication between the server and clients.

    🗄️ Prisma ORM: A next-generation ORM for type-safe database access, managing data interactions with PostgreSQL.

    🔐 JWT Authentication (jsonwebtoken): Secure token-based authentication for API endpoints.

    ☁️ Cloudinary: Cloud-based media management for efficient storage and delivery of images and files.

    📧 Nodemailer: Handles email notifications (e.g., for password recovery, MFA verification).

    🔑 Passport.js + Google OAuth: Implements OAuth 2.0 based authentication, specifically for Google login.

    🔥 Firebase Admin SDK: Used on the server-side for sending push notifications.

    🛡️ Helmet: Enhances API security by setting various HTTP headers.

    📝 Morgan: HTTP request logger middleware for Node.js.

    🍪 Cookie-Parser: Parses cookies attached to the client request object.

    🛠️ Multer: Middleware for handling multipart/form-data, primarily for file uploads.

    🔄 CORS: Configured for Cross-Origin Resource Sharing to allow frontend-backend communication.

    🛠️ UUID: Generates unique identifiers.

    ⚙️ dotenv: Manages environment variables for secure configuration.

    🔐 bcryptjs + jose: Used for password hashing and secure token handling/encryption.

⚙️ Setup and Installation

Follow these steps to get NexusChat running on your local machine.
Prerequisites

    Node.js (v18.x or later recommended)

    npm or Yarn

    Git

    PostgreSQL database (local or cloud-hosted)

    Firebase Project (for Push Notifications)

    Cloudinary Account (for File Storage)

    Google OAuth Credentials (for Google Login)

1. Clone the Repository

git clone https://github.com/EllyCarlos/NexusChat.git
cd NexusChat


2. Backend Setup

Navigate to the backend directory:

cd backend


Install backend dependencies:

npm install
# or
yarn install


Create a .env file in the backend directory and add your environment variables. Do NOT commit this file to Git.

# Database
DATABASE_URL="postgresql://YOUR_DB_USER:YOUR_DB_PASSWORD@YOUR_DB_HOST:YOUR_DB_PORT/YOUR_DB_NAME?schema=public"

# JWT Secret
JWT_SECRET="YOUR_VERY_STRONG_JWT_SECRET_KEY"

# Cloudinary
CLOUDINARY_CLOUD_NAME="YOUR_CLOUDINARY_CLOUD_NAME"
CLOUDINARY_API_KEY="YOUR_CLOUDINARY_API_KEY"
CLOUDINARY_API_SECRET="YOUR_CLOUDINARY_API_SECRET"

# Nodemailer (for email sending, e.g., SendGrid, Mailgun, or Gmail SMTP)
NODEMAILER_USER="YOUR_EMAIL_USER"
NODEMAILER_PASS="YOUR_EMAIL_PASSWORD_OR_APP_SPECIFIC_PASSWORD"

# Google OAuth
GOOGLE_CLIENT_ID="YOUR_GOOGLE_CLIENT_ID"
GOOGLE_CLIENT_SECRET="YOUR_GOOGLE_CLIENT_SECRET"
GOOGLE_AUTH_REDIRECT_URI="http://localhost:3000/auth/oauth-redirect" # For local development

# Firebase Admin SDK (for server-side push notifications)
# IMPORTANT: It's best to store this as a service account JSON file and provide its path
# For simplicity in .env, you might store the JSON content as a single-line string (escaped)
# FIREBASE_ADMIN_SDK_CONFIG_JSON='{"type": "service_account", ...}'
# Alternatively, provide a path to a downloaded JSON file:
FIREBASE_ADMIN_SDK_PATH="./path/to/your/firebase-admin-sdk.json"

# Frontend URL (for CORS) - Will be your Vercel URL in production
VERCEL_FRONTEND_URL="http://localhost:3000"

# Node Environment (for local development)
NODE_ENV="DEVELOPMENT"


Run Prisma migrations to set up your database schema:

npx prisma migrate dev --name init # Replace 'init' with a meaningful name for your first migration


Start the backend server:

npm run dev
# or
yarn dev


The backend server should now be running on http://localhost:5000 (or your configured port).
3. Frontend Setup

Navigate to the frontend directory:

cd ../frontend


Install frontend dependencies:

npm install
# or
yarn install


Create a .env.local file in the frontend directory and add your environment variables. Do NOT commit this file to Git.

# Backend API URL (for local development)
NEXT_PUBLIC_BACKEND_URL="http://localhost:5000"

# Socket.IO Server URL (for local development)
NEXT_PUBLIC_SOCKET_SERVER_URL="http://localhost:5000"

# Firebase Config (get these from your Firebase project settings -> Project settings -> Your apps -> Web app)
NEXT_PUBLIC_FIREBASE_API_KEY="YOUR_FIREBASE_API_KEY"
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN="YOUR_FIREBASE_PROJECT_ID.firebaseapp.com"
NEXT_PUBLIC_FIREBASE_PROJECT_ID="YOUR_FIREBASE_PROJECT_ID"
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET="YOUR_FIREBASE_PROJECT_ID.appspot.com"
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID="YOUR_FIREBASE_MESSAGING_SENDER_ID"
NEXT_PUBLIC_FIREBASE_APP_ID="YOUR_FIREBASE_APP_ID"
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID="YOUR_FIREBASE_MEASUREMENT_ID" # Starts with G-

# Cloudinary (if used directly on frontend for some cases)
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME="YOUR_CLOUDINARY_CLOUD_NAME"


Start the Next.js development server:

npm run dev
# or
yarn dev


The frontend application should now be running on http://localhost:3000.
🚀 Deployment

NexusChat is designed for deployment with Vercel for the frontend and Render for the backend and database.
Frontend (Next.js) on Vercel

    Connect GitHub Repository: Link your NexusChat repository to Vercel.

    Configure Root Directory: If your Next.js app is in the frontend/ subdirectory, set the "Root Directory" to frontend.

    Set Environment Variables: Add your NEXT_PUBLIC_ prefixed environment variables from your .env.local file to Vercel's project settings (under "Environment Variables").

        NEXT_PUBLIC_BACKEND_URL: This will be the public URL of your deployed Render backend.

        NEXT_PUBLIC_SOCKET_SERVER_URL: This will also be the public URL of your deployed Render backend.

    Modify Build Command: In Vercel's "Build & Development Settings," set the "Build Command" to:

    npx prisma generate && npm run build


    This ensures Prisma Client is generated correctly in Vercel's caching environment.

    Deploy: Vercel will automatically build and deploy your Next.js application. Note the deployed URL.

Backend (Node.js + Express) on Render

    Deploy PostgreSQL Database:

        In the Render dashboard, create a new PostgreSQL service.

        Note down the Internal Database URL once created.

    Deploy Web Service (Node.js Backend):

        In the Render dashboard, create a new Web Service.

        Connect your NexusChat GitHub repository.

        Root Directory: Set this to backend (if your backend code is in that subdirectory).

        Build Command: npm install && npm run build

        Start Command: npm start

        Environment Variables: Add all your backend environment variables from your backend/.env file.

            DATABASE_URL: Use the Internal Database URL from your Render PostgreSQL service.

            VERCEL_FRONTEND_URL: Crucially, update this with the actual deployed URL of your Vercel frontend. This is essential for CORS.

            Ensure NODE_ENV is set to PRODUCTION.

        Pre-deploy Command (Recommended for Migrations): To ensure your database migrations run automatically on each deploy, add npx prisma migrate deploy as a "Pre-deploy Command" in your Render web service settings.

    Deploy: Render will build and deploy your Node.js backend. Note the deployed public URL.

Final Step: Connect Frontend to Backend

After both are deployed:

    Go back to your Vercel Project settings.

    Update the NEXT_PUBLIC_BACKEND_URL and NEXT_PUBLIC_SOCKET_SERVER_URL environment variables to point to the public URL of your deployed Render backend.

    Trigger a new Vercel deployment for the frontend.

Your full-stack NexusChat application should now be live and fully connected!
🤝 Contributing

We welcome contributions! Please feel free to open issues or submit pull requests.
📄 License

Apache 2.0
