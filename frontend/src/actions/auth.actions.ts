"use server";
import { DEFAULT_AVATAR } from "@/constants";
import { sendEmail } from "@/lib/server/email/SendEmail";
import { generateOtp } from "@/lib/server/helpers";
import { prisma } from "@/lib/server/prisma";
import { FetchUserInfoResponse } from "@/lib/server/services/userService";
import { createSession, decrypt, deleteSession, encrypt, SessionPayload } from "@/lib/server/session";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import jwt from 'jsonwebtoken';

export async function login(prevState: any, formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  try {
    if (!email || !password) {
      return {
        errors: {
          message: "Invalid Credentials",
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
// Add this function to your auth.actions.ts file
export async function forgotPassword(prevState: any, email: string) {
  try {
    if (!email) {
      return {
        errors: {
          message: "Email is required"
        },
        success: {
          message: null
        }
      };
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        username: true
      }
    });

    if (!user) {
      // For security, don't reveal if email exists or not
      return {
        errors: {
          message: null
        },
        success: {
          message: "If an account with that email exists, we've sent a password reset link."
        }
      };
    }

    // Generate reset token
    const resetPasswordToken = await encrypt({
      userId: user.id,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24) // 24 hours
    });
    
    const hashedResetToken = await bcrypt.hash(resetPasswordToken, 10);

    // Delete any existing reset tokens for this user
    await prisma.resetPasswordToken.deleteMany({
      where: { userId: user.id }
    });

    // Create new reset token
    await prisma.resetPasswordToken.create({
      data: {
        userId: user.id,
        hashedToken: hashedResetToken,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24) // 24 hours
      }
    });

    // Create reset URL
    const resetUrl = `${process.env.NEXT_PUBLIC_CLIENT_URL}/auth/reset-password?token=${resetPasswordToken}`;

    // Send email (you'll need to add this email type to your sendEmail function)
    await sendEmail({
      emailType: "passwordReset",
      to: user.email,
      username: user.username,
      verificationUrl: resetUrl
    });

    return {
      errors: {
        message: null
      },
      success: {
        message: "If an account with that email exists, we've sent a password reset link."
      }
    };

  } catch (error) {
    console.log('Error sending password reset email:', error);
    return {
      errors: {
        message: "Error sending password reset email"
      },
      success: {
        message: null
      }
    };
  }
}
// ✅ Update your auth.actions.ts verifyOAuthToken function

// Fixed verifyOAuthToken function - replace the existing implementation
// Enhanced verifyOAuthToken with comprehensive debugging
// Replace your existing verifyOAuthToken function with this cleaned up version:
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function verifyOAuthToken(prevState: any, token: string) {
  try {
    if (!token) {
      return {
        errors: {
          message: "Token is required"
        },
        data: null
      };
    }

    console.log('🔍 Verifying OAuth token...');
    
    if (!process.env.JWT_SECRET) {
      console.error('❌ JWT_SECRET is not configured');
      return {
        errors: {
          message: "Server configuration error"
        },
        data: null
      };
    }

    // Use the jwt import from the top of the file (remove the require inside)
    const decoded = jwt.verify(token, process.env.JWT_SECRET) as any;
    
    console.log('🔍 Decoded token structure:', {
      keys: Object.keys(decoded),
      userId: decoded.userId,
      isNewUser: decoded.isNewUser,
      type: decoded.type
    });
       
    if (!decoded.userId) {
      console.error('❌ Missing userId in token. Available fields:', Object.keys(decoded));
      return {
        errors: {
          message: "Invalid user identifier in token"
        },
        data: null
      };
    }

    if (typeof decoded.isNewUser !== 'boolean') {
      console.error('❌ Invalid isNewUser type:', typeof decoded.isNewUser, 'Value:', decoded.isNewUser);
      return {
        errors: {
          message: "Invalid token structure"
        },
        data: null
      };
    }

    console.log('✅ Token validation passed:', {
      userId: decoded.userId,
      isNewUser: decoded.isNewUser
    });

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
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
        oAuthSignup: true
      }
    });

    if (!user) {
      console.error('❌ User not found in database for ID:', decoded.userId);
      return {
        errors: {
          message: "User not found"
        },
        data: null
      };
    }

    console.log('✅ User found in database:', user.id);

    // Create session
    await createSession(user.id);

    const responseData: any = {
      user,
      sessionToken: token
    };

    if (decoded.isNewUser) {
      responseData.combinedSecret = `${user.id}_${user.email}_${Date.now()}`;
      console.log('🆕 New user - added combinedSecret');
    }

    console.log('✅ OAuth verification successful for user:', user.id);
    return {
      errors: {
        message: null
      },
      data: responseData
    };

  } catch (error) {
    console.error('🚨 OAuth token verification error:', error);
    
    if (error instanceof Error) {
      if (error.name === 'JsonWebTokenError') {
        console.error('JWT Error details:', error.message);
        return {
          errors: {
            message: "Invalid token format"
          },
          data: null
        };
      }
      if (error.name === 'TokenExpiredError') {
        console.error('Token expired');
        return {
          errors: {
            message: "Token expired"
          },
          data: null
        };
      }
    }
    
    console.error('Unexpected error:', error);
    return {
      errors: {
        message: "Token verification failed"
      },
      data: null
    };
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


