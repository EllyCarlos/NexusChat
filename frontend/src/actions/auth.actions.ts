"use server";
import { DEFAULT_AVATAR } from "@/constants";
import { sendEmail } from "@/lib/server/email/SendEmail";
import { generateOtp } from "@/lib/server/helpers";
import { prisma } from "@/lib/server/prisma";
import { FetchUserInfoResponse } from "@/lib/server/services/userService";
import { createSession, decrypt, deleteSession, encrypt, SessionPayload } from "@/lib/server/session";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";

export async function login(prevState: any, formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  try {
    if (!email || !password) {
      return {
        errors: {
          message: "Invalid Credentails",
        },
        redirect:false
      };
    }

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return {
        errors: {
          message: "Invalid Credentials",
        },
        redirect:false,
      };
    }

    if (await bcrypt.compare(password, user.hashedPassword)) {
      await createSession(user.id);
      return {
        errors: {
          message:null,
        },
        redirect: true,
      }
    } else {
      return {
        errors: {
          message: "Invalid Credentials",
        },
        redirect:false,
      };
    }
  } catch (error) {
    console.log(error);
  }
}

export async function signup(prevState: any, formData: FormData) {
  const username = formData.get("username") as string;
  const password = formData.get("password") as string;
  const email = formData.get("email") as string;
  const name = formData.get("name") as string;

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (user) {
    return {
      errors: {
        message: "User already exists",
      },
    };
  }

  const existingUsername = await prisma.user.findUnique({
    where: { username },
  });

  if (existingUsername) {
    return {
      errors: {
        message: "Username is already taken",
      },
    };
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const newUser = await prisma.user.create({
    data: {
      email,
      hashedPassword,
      username,
      avatar: DEFAULT_AVATAR,
      name,
    },
    select: {
      id: true,
      name: true,
      username: true,
      avatar: true,
      email: true,
      createdAt: true,
      updatedAt: true,
      emailVerified: true,
      publicKey: true,
      notificationsEnabled: true,
      verificationBadge: true,
      fcmToken: true,
      oAuthSignup: true,
    },
  });

  await createSession(newUser.id);

  return {
    errors: null,
    data:newUser
  };
}

export async function logout(){
  await deleteSession();
}

export async function sendPrivateKeyRecoveryEmail(prevState:any,user:Pick<FetchUserInfoResponse, "id" | "email" | "username">){

  try {
    const {email,id,username} = user;

    const privateKeyRecoveryToken =  await encrypt({userId:id,expiresAt:new Date(Date.now()+1000*60*60*24*30)});
    const privateKeyRecoveryHashedToken = await bcrypt.hash(privateKeyRecoveryToken,10);
  
    await prisma.privateKeyRecoveryToken.deleteMany({
      where:{userId:id}
    })
    await prisma.privateKeyRecoveryToken.create({
      data:{userId:id,hashedToken:privateKeyRecoveryHashedToken,expiresAt:new Date(Date.now()+1000*60*60*24*30)}
    })
  
    const privateKeyRecoveryUrl = `${process.env.NEXT_PUBLIC_CLIENT_URL}/auth/private-key-recovery-token-verification?token=${privateKeyRecoveryToken}`
  
    await sendEmail({emailType:"privateKeyRecovery",to:email,username,verificationUrl:privateKeyRecoveryUrl})
    return {
      errors:{
        message:null
      },
      success:{
        message:"Private key recovery email sent successfully"
      }
    }
  }
  catch (error) {
    console.log('error sending private key recovery email',error);
    return {
      errors:{
        message:"Error sending private key recovery email"
      },
      success:{
        message:null
      }
    }
  }

}

export async function verifyPrivateKeyRecoveryToken(prevState:any,data:{recoveryToken:string,userId:string}){
  try {
    
    const recoveryTokenExists =  await prisma.privateKeyRecoveryToken.findFirst({
        where:{userId:data.userId}
    })

    if(!recoveryTokenExists){
        return {
            errors:{
                message:'Verification link is not valid'
            },
            data:null
        }
    }

    if(recoveryTokenExists.expiresAt < new Date){
        return {
            errors:{
                message:'Verification link has expired'
            },
            data:null
        }
    }
    
    if(!(await bcrypt.compare(data.recoveryToken,recoveryTokenExists.hashedToken))){
        return {
            errors:{
                message:'Verification link is not valid'
            },
            data:null
        }
    }
    const decodedData = await decrypt(data.recoveryToken);
    
    if(decodedData.userId !== data.userId){
        return {
            errors:{
                message:'Verification link is not valid'
            },
            data:null
        }
    }

    const user = await prisma.user.findUnique({where:{id:data.userId},select:{id:true,privateKey:true,oAuthSignup:true,googleId:true}});

    if(!user){
        return {
            errors:{
                message:'User not found, verification link is not valid'
            },
            data:null
        }
    }

    const payload:{privateKey?:string,combinedSecret?:string} = {
        privateKey:user.privateKey!
    }

    if(user.oAuthSignup) payload['combinedSecret'] = user.googleId+process.env.PRIVATE_KEY_RECOVERY_SECRET;

    await prisma.privateKeyRecoveryToken.deleteMany({where:{userId:data.userId}})

    return {
        errors:{
            message:null
        },
        data:payload
    }

  } catch (error) {
    console.log('error verifying private key recovery token',error);
    return {
        errors:{
            message:'Error verifying private key recovery token'
        },
        data:null
    }
  }
}

export async function verifyPassword(prevState:any,data:{userId:string,password:string}){

  try {

    const {password,userId} = data;

    const user =  await prisma.user.findUnique({where:{id:userId}});

    if(!user){
      return {
        errors:{
          message:'User not found'
        },
        success:{
          message:null
        }
      }
    }

    if(!await bcrypt.compare(password,user.hashedPassword)){
      return {
        errors:{
          message:'Invalid password'
        },
        success:{
          message:null
        }
      }
    }

    const privateKeyRecoveryToken =  await encrypt({userId,expiresAt:new Date(Date.now()+1000*60*60*24*30)});
    const privateKeyRecoveryHashedToken = await bcrypt.hash(privateKeyRecoveryToken,10);
  
    await prisma.privateKeyRecoveryToken.deleteMany({
      where:{userId}
    })
    await prisma.privateKeyRecoveryToken.create({
      data:{userId,hashedToken:privateKeyRecoveryHashedToken,expiresAt:new Date(Date.now()+1000*60*60*24*30)}
    })
  
    const privateKeyRecoveryUrl = `${process.env.NEXT_PUBLIC_CLIENT_URL}/auth/private-key-recovery-token-verification?token=${privateKeyRecoveryToken}`
    await sendEmail({emailType:"privateKeyRecovery",to:user.email,username:user.username,verificationUrl:privateKeyRecoveryUrl})

    return {
      errors:{
        message:null
      },
      success:{
        message:`Private key recovery email sent successfully on ${user.email}`
      }
    }

  }
  catch (error) {
    console.log('error verifying password',error);
    return {
      errors:{
        message:'Error verifying password'
      },
      success:{
        message:null
      }
    }
  }

}
// ✅ Update your auth.actions.ts verifyOAuthToken function

// Fixed verifyOAuthToken function - replace the existing implementation
export const verifyOAuthToken = async (prevState: any, token: string) => {
  try {
    // First try the API approach
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/auth/verify-oauth-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token }),
      });

      const data = await response.json();

      if (response.ok) {
        return {
          errors: {
            message: null
          },
          data: {
            user: data.user,
            sessionToken: data.sessionToken,
            combinedSecret: data.combinedSecret,
          }
        };
      }
    } catch (apiError) {
      console.log('API verification failed, falling back to local verification:', apiError);
    }

    // Fallback to local token verification
    let decodedInfo;
    try {
      decodedInfo = await decrypt(token) as { 
        user: string, 
        oAuthNewUser: boolean 
      };
    } catch (decryptError) {
      console.error('verifyOAuthToken: Token decryption failed:', decryptError);
      return {
        errors: {
          message: 'Invalid or expired token'
        },
        data: null
      };
    }

    // Validate decoded info structure
    if (!decodedInfo || typeof decodedInfo !== 'object') {
      console.error('verifyOAuthToken: Invalid decoded token structure:', decodedInfo);
      return {
        errors: {
          message: 'Invalid token format'
        },
        data: null
      };
    }

    const { oAuthNewUser, user: userId } = decodedInfo;

    // Validate userId exists and is not empty
    if (!userId || typeof userId !== 'string') {
      console.error('verifyOAuthToken: Invalid or missing userId in token:', { userId, type: typeof userId });
      return {
        errors: {
          message: 'Invalid user identifier in token'
        },
        data: null
      };
    }

    // Log for debugging (remove in production)
    console.log('verifyOAuthToken: Processing token for userId:', userId, 'isNewUser:', oAuthNewUser);

    // Find the user by ID and get full user data for response
    let existingUser;
    try {
      existingUser = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          username: true,
          avatar: true,
          email: true,
          createdAt: true,
          updatedAt: true,
          emailVerified: true,
          publicKey: true,
          notificationsEnabled: true,
          verificationBadge: true,
          fcmToken: true,
          oAuthSignup: true,
          googleId: true,
        }
      });
    } catch (prismaError) {
      console.error('verifyOAuthToken: Prisma query failed:', prismaError);
      return {
        errors: {
          message: 'Database error during user lookup'
        },
        data: null
      };
    }

    // Check if user exists
    if (!existingUser) {
      console.error('verifyOAuthToken: User not found for ID:', userId);
      return {
        errors: {
          message: 'User not found'
        },
        data: null
      };
    }

    // Log successful user lookup
    console.log('verifyOAuthToken: User found:', {
      id: existingUser.id,
      hasGoogleId: !!existingUser.googleId,
      email: existingUser.email
    });

    // Create session
    try {
      await createSession(existingUser.id);
    } catch (sessionError) {
      console.error('verifyOAuthToken: Session creation failed:', sessionError);
      return {
        errors: {
          message: 'Failed to create session'
        },
        data: null
      };
    }

    // Prepare response payload with full user data
    const responsePayload: { 
      combinedSecret?: string, 
      user: {
        id: string;
        name: string;
        username: string;
        avatar: string | null;
        email: string;
        createdAt: Date;
        updatedAt: Date;
        emailVerified: boolean;
        publicKey: string | null;
        notificationsEnabled: boolean;
        verificationBadge: boolean;
        fcmToken: string | null;
        oAuthSignup: boolean;
      }
    } = {
      user: {
        id: existingUser.id,
        name: existingUser.name,
        username: existingUser.username,
        avatar: existingUser.avatar,
        email: existingUser.email,
        createdAt: existingUser.createdAt,
        updatedAt: existingUser.updatedAt,
        emailVerified: existingUser.emailVerified,
        publicKey: existingUser.publicKey,
        notificationsEnabled: existingUser.notificationsEnabled,
        verificationBadge: existingUser.verificationBadge,
        fcmToken: existingUser.fcmToken,
        oAuthSignup: existingUser.oAuthSignup,
      }
    };

    // Add combined secret for new users
    if (oAuthNewUser) {
      if (!existingUser.googleId) {
        console.warn('verifyOAuthToken: New OAuth user missing googleId:', existingUser.id);
      } else {
        const combinedSecret = existingUser.googleId + process.env.PRIVATE_KEY_RECOVERY_SECRET;
        responsePayload['combinedSecret'] = combinedSecret;
        console.log('verifyOAuthToken: Added combined secret for new user');
      }
    }

    return {
      errors: {
        message: null
      },
      data: responsePayload
    };

  } catch (error) {
    console.error('verifyOAuthToken: Unexpected error:', error);
    return {
      errors: {
        message: 'Error verifying OAuth token'
      },
      data: null
    };
  }
};
export async function sendResetPasswordLink(prevState:any,email:string){

  try {

    const user = await prisma.user.findUnique({where:{email}});

    if(!user){
      return {
        errors:{
          message:'Email does not exists'
        },
        success:{
          message:null
        }
      }
    }

    // deleting previous reset password tokens for this user, if they exists
    await prisma.resetPasswordToken.deleteMany({where:{userId:user.id}})

    const resetPasswordToken = await encrypt({expiresAt:new Date(Date.now()+1000*60*60*24*30),userId:user.id})
    const hashedResetPasswordToken = await bcrypt.hash(resetPasswordToken,10)

    await prisma.resetPasswordToken.create({
        data:{
            userId:user.id,
            hashedToken:hashedResetPasswordToken,
            expiresAt:new Date(Date.now()+1000*60*60*24*30)
        }
    })

    const resetPasswordUrl = `${process.env.NEXT_PUBLIC_CLIENT_URL}/auth/reset-password?token=${resetPasswordToken}`
    await sendEmail({emailType:"resetPassword",to:user.email,username:user.username,resetPasswordUrl})
    
    return {
      errors:{
        message:null
      },
      success:{
        message:`We have sent a password reset link on ${email}, please check spam if not received`
      }
    }

  } catch (error) {
    console.log('error sending reset password link',error);
    return {
      errors:{
        message:'Error sending reset password link'
      },
      success:{
        message:null
      }
    }
  }
}

export async function resetPassword(prevState:any,data:{token:string,newPassword:string}){
  try {
    const {newPassword,token} = data;

    const {userId} = await decrypt(token) as SessionPayload;

    const resetPasswordTokenExists = await prisma.resetPasswordToken.findFirst({where:{userId}});

    if(!resetPasswordTokenExists){
      return {
        errors:{
          message:'Password reset link is invalid'
        },
        success:{
          message:null
        }
      }
    }

    if(resetPasswordTokenExists.expiresAt < new Date){
       return {
        errors:{
          message:'Password reset link has been expired'
        },
        success:{
          message:null
        }
       }
    }

    const user = await prisma.user.findUnique({where:{id:userId}});

    if(!user){
      return {
        errors:{
          message:'User not found'
        },
        success:{
          message:null
        }
      }
    }

    await prisma.user.update({
        where:{id:user.id},
        data:{hashedPassword:await bcrypt.hash(newPassword,10)}
    })

    await prisma.resetPasswordToken.delete({where:{id:resetPasswordTokenExists.id}});
  
    return {
      errors:{
        message:null
      },
      success:{
        message:`Dear ${user.username}, your password has been reset successfuly`
      }
    }

  } catch (error) {
    console.log('error resetting password',error);
    return {
      errors:{
        message:'Error resetting password'
      },
      success:{
        message:null
     }
  }
 }
}

export async function storeUserKeysInDatabase(prevState:any,data:{publicKey:JsonWebKey,privateKey:string,loggedInUserId:string}){
  try {
    console.log('action called!!');
    const {privateKey,publicKey,loggedInUserId} = data;

    const user = await prisma.user.findUnique({where:{id:loggedInUserId}});
    if(!user){
      return {
        errors:{
          message:'User not found'
        },
        success:{
          message:null
        }
      }
    }

    const updatedUser =  await prisma.user.update({
        where:{id:user.id},
        data:{publicKey:JSON.stringify(publicKey),privateKey},
        select:{publicKey:true}
    })

    return {
      errors:{
        message:null
      },
      success:{
        message:'User keys stored in database successfully'
      },
      data:{
        publicKey:updatedUser.publicKey
      }
    }

  } catch (error) {
    console.log('error storing user keys in database',error);
    return {
      errors:{
        message:'Error storing user keys in database'
      },
      success:{
        message:null
      }
    }
  }
}

export async function sendOtp(prevState:any,data:{loggedInUserId:string,email:string,username:string}){
  try { 

    const {loggedInUserId,email,username} = data;
    await prisma.otp.deleteMany({where:{userId:loggedInUserId}})

    const otp = generateOtp()
    const hashedOtp = await bcrypt.hash(otp,10)

    await prisma.otp.create({
        data:{
          userId:loggedInUserId,
          hashedOtp,
          expiresAt:new Date(Date.now()+1000*60*5)
        }
    })

    await sendEmail({emailType:"OTP",to:email,username,otp:otp});

    return {
      errors:{
        message:null
      },
      success:{
        message:`We have sent the otp on ${email}, please check spam if not received`
    }

  }
  } catch (error) {
    console.log('error sending otp',error);
    return {
      errors:{
        message:'Error sending otp'
      },
      success:{
        message:null
      }
    }
  }
}

export async function verifyOtp(prevState:any,data:{otp:string,loggedInUserId:string}){

  const {otp,loggedInUserId} = data;

  const otpExists = await prisma.otp.findFirst({
      where:{userId:loggedInUserId}
  })

  if(!otpExists){
      return {
          errors:{
              message:'Otp does not exists'
          },
          success:{
              message:null
          }
      }
  }

  if(otpExists.expiresAt! < new Date){
    return {
        errors:{
            message:'Otp has expired'
        },
        success:{
            message:null
        }
    }
  }
  
  if(!(await bcrypt.compare(otp,otpExists.hashedOtp))){
    return {
        errors:{
            message:'Otp is invalid, please enter a valid otp'
        },
        success:{
            message:null
        }
    }
  }
  
  await prisma.user.update({
      where:{id:loggedInUserId},
      data:{emailVerified:true},
  })

  await prisma.otp.delete({where:{id:otpExists.id}})
    
  return {
      errors:{
          message:null
      },
      success:{
          message:'Email verified successfully 🎉'
      },
  }
}

export async function getAuthToken() {
  const token = (await cookies()).get("token")?.value;
  return token || null;
}


