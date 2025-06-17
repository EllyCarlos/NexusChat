import Image from "next/image"

type PropTypes = {
    username:string,
    avatar:string
}

export const TypingCard = ({username,avatar}:PropTypes) => {
  return (
    <div className="flex item-center gap-2">
        <Image className="size-6 rounded-full object-cover"  height={100} width={100} src={avatar} alt={username}/>
        <p className="text-secondary-darker">{username}</p> 
    </div>
  )
}
