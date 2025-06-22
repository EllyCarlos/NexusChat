import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";

// Prisma query function
export const fetchUserCallHistory = async ({
  loggedInUserId,
}: {
  loggedInUserId: string;
}) => {
  const callHistory = await prisma.callHistory.findMany({
    where: {
      OR: [
        { callerId: loggedInUserId },
        { calleeId: loggedInUserId }
      ]
    },
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      status: true,
      callee: {
        select: {
          id: true,
          username: true,
          avatar: true,
          verificationBadge: true,
        }
      },
      caller: {
        select: {
          id: true,
          username: true,
          avatar: true,
          verificationBadge: true,
        }
      }
    },
    orderBy: {
      startedAt: "desc"
    },
    take: 40
  });

  return callHistory;
};
