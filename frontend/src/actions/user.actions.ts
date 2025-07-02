"use server";

import { prisma } from "@/lib/server/prisma";

// --- SEARCH USER ---
export async function searchUser(prevState: any, data: { username: string }) {
  try {
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
      // Consider adding a limit to the number of search results to prevent
      // returning too much data and for performance reasons.
      // take: 10, // Example: Limit to 10 results
    });

    return {
      errors: {
        message: null,
      },
      data: users,
    };

  } catch (error) {
    console.error("Error fetching search user results:", error); // Use console.error
    return {
      errors: {
        message: "An unexpected error occurred during user search.", // More specific message
      },
      data: null,
    };
  }
}

// --- STORE FCM TOKEN ---
export async function storeFcmToken(prevState: any, data: { fcmToken: string, loggedInUserId: string }) {
  try {
    const { fcmToken, loggedInUserId } = data;

    // Input validation: Ensure fcmToken and loggedInUserId are provided
    if (!fcmToken || typeof fcmToken !== 'string' || fcmToken.trim().length === 0) {
      return {
        errors: { message: "FCM token is required." },
        data: null,
      };
    }
    if (!loggedInUserId || typeof loggedInUserId !== 'string' || loggedInUserId.trim().length === 0) {
        return {
          errors: { message: "User ID is required to store FCM token." },
          data: null,
        };
      }

    const user = await prisma.user.findUnique({
      where: { id: loggedInUserId }
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
      where: { id: loggedInUserId },
      data: { fcmToken }
    });

    return {
      errors: {
        message: null,
      },
      data: null, // No specific data needed on success for this action
    };

  } catch (error) {
    console.error("Error storing FCM token:", error); // Use console.error
    return {
      errors: {
        message: "An unexpected error occurred while storing FCM token.", // More specific message
      },
      data: null,
    };
  }
}

// --- UPDATE USER NOTIFICATION STATUS ---
export async function updateUserNotificationStatus(prevState: any, data: { loggedInUserId: string, notificationStatus: boolean }) {
  try {
    const { loggedInUserId, notificationStatus } = data;

    // Input validation
    if (!loggedInUserId || typeof loggedInUserId !== 'string' || loggedInUserId.trim().length === 0) {
        return {
            errors: { message: "User ID is required to update notification status." },
            success: { message: null }
        };
    }
    // Ensure notificationStatus is a boolean
    if (typeof notificationStatus !== 'boolean') {
        return {
            errors: { message: "Notification status must be a boolean (true/false)." },
            success: { message: null }
        };
    }


    const user = await prisma.user.findUnique({ where: { id: loggedInUserId } });

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
      where: { id: loggedInUserId },
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

  } catch (error) {
    console.error("Error updating user notification status:", error); // Use console.error
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