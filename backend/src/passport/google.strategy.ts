import bcrypt from 'bcryptjs';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { config } from '../config/env.config.js';
import { DEFAULT_AVATAR } from '../constants/file.constant.js';
import { prisma } from '../lib/prisma.lib.js';
import { env } from '../schemas/env.schema.js';

passport.use(new GoogleStrategy({
    clientID: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    callbackURL:config.callbackUrl
  },

  async function (accessToken, refreshToken, profile, done){

    try {
      if(profile.emails && profile.emails[0].value && profile.displayName){

          const isExistingUser = await prisma.user.findUnique({where:{email:profile.emails[0].value}})

          if(isExistingUser){
            const transformedUser = {
              id:isExistingUser.id,
              username:isExistingUser.username,
              name:isExistingUser.name,
              avatar:isExistingUser.avatar,
              email:isExistingUser.email,
              emailVerified:isExistingUser.emailVerified,
              newUser:false,
              googleId:profile.id
            }
            done(null,transformedUser)
          }
          else{
            let avatarUrl = DEFAULT_AVATAR
            if(profile.photos && profile.photos[0].value){
              avatarUrl=profile.photos[0].value
            }
            const newUser = await prisma.user.create({
              data:{
                username:profile.displayName,
                name:profile.name?.givenName!,
                avatar:avatarUrl,
                email:profile.emails[0].value,
                hashedPassword:await bcrypt.hash(profile.id,10),
                emailVerified:true,
                oAuthSignup:true,
                googleId:profile.id
              },
              select:{
                id:true,
                username:true,
                name:true,
                avatar:true,
                email:true,
                emailVerified:true,
                googleId:true
              }
            })
            done(null,{...newUser,newUser:true})
          }
      }
      else{
        throw new Error("Some Error occured")
      }
    } catch (error) {
      console.log(error);
      done('Some error occured',undefined)
    }
  }
));