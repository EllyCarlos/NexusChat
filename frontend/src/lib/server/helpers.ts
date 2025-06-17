export const generateOtp=():string=>{
    let OTP=""
    for(let i= 0 ; i<4 ; i++) OTP+=Math.floor(Math.random()*10)
    return OTP
}