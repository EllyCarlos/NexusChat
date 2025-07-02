// src/app/api/auth/complete-recovery/route.ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import prisma from '@/lib/server/prisma'; // Adjust path to your Prisma client
import { verifySession } from '@/lib/server/session'; // Assuming you have a session verification utility

export async function POST(req: Request) {
  try {
    const cookieStore = cookies();
    const sessionToken = cookieStore.get('session')?.value; // Get your session cookie

    if (!sessionToken) {
      return NextResponse.json({ message: 'Unauthorized: No session token' }, { status: 401 });
    }

    // Verify the session token to get the user's ID
    const userId = await verifySession(sessionToken); // Replace with your actual session verification logic
    if (!userId) {
      return NextResponse.json({ message: 'Unauthorized: Invalid session' }, { status: 401 });
    }

    // Update the user's needsKeyRecovery status in the database
    await prisma.user.update({
      where: { id: userId },
      data: {
        needsKeyRecovery: false,
        keyRecoveryCompletedAt: new Date(), // Set the completion timestamp
      },
    });

    return NextResponse.json({ success: true }, { status: 200 });

  } catch (error) {
    console.error('Failed to complete private key recovery on backend:', error);
    return NextResponse.json({ error: 'Failed to complete recovery' }, { status: 500 });
  }
}