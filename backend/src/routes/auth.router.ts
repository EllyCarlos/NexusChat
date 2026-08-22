import { Router } from "express";
import { checkAuth, getUserInfo, redirectHandler, updateFcmToken } from "../controllers/auth.controller.js";
import { authenticateGoogleOAuthCallback, beginGoogleOAuth, validateGoogleOAuthState } from "../middlewares/oauth-state.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { verifyToken } from "../middlewares/verify-token.middleware.js";
import { fcmTokenSchema } from "../schemas/auth.schema.js";

export default Router()

.get("/user",verifyToken,getUserInfo)
.get("/verify-token",verifyToken,checkAuth)
.patch("/user/update-fcm-token",verifyToken,validate(fcmTokenSchema),updateFcmToken)
.get("/google",beginGoogleOAuth)
.get(
  "/google/callback",
  validateGoogleOAuthState,
  authenticateGoogleOAuthCallback,
  redirectHandler
)
