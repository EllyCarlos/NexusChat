"use server";

import { prisma } from "@/lib/server/prisma";
import { getAuthenticatedSession } from "@/lib/server/authenticatedSession";
import {
  consumeServerActionRateLimit,
  RATE_LIMIT_MESSAGE,
  type RateLimitPolicy,
} from "@/lib/server/rateLimit";

const HOUR_MS = 60 * 60 * 1000;
const USER_ACTION_LIMITS = {
  search: { namespace: "user-search", limit: 30, windowMs: 60 * 1000 },
  fcmToken: { namespace: "fcm-token", limit: 20, windowMs: HOUR_MS },
  notificationSettings: { namespace: "notification-settings", limit: 30, windowMs: HOUR_MS },
} satisfies Record<string, RateLimitPolicy>;

// --- SEARCH USER ---
export async function searchUser(prevState: any, data: { username: string }) {
  try {
    const session = await getAuthenticatedSession();
    if (!session) {
      return {
        errors: { message: "Authentication is required." },
        data: null,
      };
    }

    if (!consumeServerActionRateLimit(USER_ACTION_LIMITS.search, session.userId).allowed) {
      return {
        errors: { message: RATE_LIMIT_MESSAGE },
        data: null,
      };
    }

    const { username } = data;

    // Input validation: Ensure username is provided and not just whitespace
    if (!username || typeof username !== 'string' || username.trim().length === 0) {
      return {
        errors: {
          message: "Username cannot be empty.",
        },
        data: null,
      };
    }

    const searchTerm = username.trim();

    const users = await prisma.user.findMany({
      where: {
        username: {
          contains: searchTerm,
          mode: "insensitive" // Case-insensitive search
        }
      },
      select: {
        id: true,
        name: true,
        username: true,
        avatar: true
      },
      take: 20,
    });

    return {
      errors: {
        message: null,
      },
      data: users,
    };

  } catch {
    console.error("Failed to fetch user search results.");
    return {
      errors: {
        message: "An unexpected error occurred during user search.", // More specific message
      },
      data: null,
    };
  }
}

// --- STORE FCM TOKEN ---
export async function storeFcmToken(_prevState: unknown, data: { fcmToken: string }) {
  try {
    const session = await getAuthenticatedSession();
    if (!session) {
      return {
        errors: { message: "Authentication is required." },
        data: null,
      };
    }

    if (!consumeServerActionRateLimit(USER_ACTION_LIMITS.fcmToken, session.userId).allowed) {
      return {
        errors: { message: RATE_LIMIT_MESSAGE },
        data: null,
      };
    }

    const { fcmToken } = data;

    if (!fcmToken || typeof fcmToken !== 'string' || fcmToken.trim().length === 0) {
      return {
        errors: { message: "FCM token is required." },
        data: null,
      };
    }
    const user = await prisma.user.findUnique({
      where: { id: session.userId }
    });

    if (!user) {
      return {
        errors: {
          message: "User not found. Cannot store FCM token.",
        },
        data: null,
      };
    }

    await prisma.user.update({
      where: { id: session.userId },
      data: { fcmToken }
    });

    return {
      errors: {
        message: null,
      },
      data: null, // No specific data needed on success for this action
    };

  } catch {
    console.error("Failed to store the notification token.");
    return {
      errors: {
        message: "An unexpected error occurred while storing FCM token.", // More specific message
      },
      data: null,
    };
  }
}

// --- UPDATE USER NOTIFICATION STATUS ---
export async function updateUserNotificationStatus(_prevState: unknown, data: { notificationStatus: boolean }) {
  try {
    const session = await getAuthenticatedSession();
    if (!session) {
      return {
        errors: { message: "Authentication is required." },
        success: { message: null }
      };
    }

    if (!consumeServerActionRateLimit(USER_ACTION_LIMITS.notificationSettings, session.userId).allowed) {
      return {
        errors: { message: RATE_LIMIT_MESSAGE },
        success: { message: null }
      };
    }

    const { notificationStatus } = data;

    // Input validation
    // Ensure notificationStatus is a boolean
    if (typeof notificationStatus !== 'boolean') {
        return {
            errors: { message: "Notification status must be a boolean (true/false)." },
            success: { message: null }
        };
    }


    const user = await prisma.user.findUnique({ where: { id: session.userId } });

    if (!user) {
      return {
        errors: {
          message: "User not found. Cannot update notification status.",
        },
        success: {
          message: null
        }
      };
    }

    await prisma.user.update({
      where: { id: session.userId },
      data: { notificationsEnabled: notificationStatus }
    });

    return {
      errors: {
        message: null
      },
      success: {
        message: `Notifications ${notificationStatus ? "enabled" : "disabled"} successfully.`
      }
    };

  } catch {
    console.error("Failed to update notification status.");
    return {
      errors: {
        message: "An unexpected error occurred while updating notification status.", // More specific message
      },
      success: {
        message: null
      }
    };
  }
}
