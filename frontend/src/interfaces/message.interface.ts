export interface Message {
    sender: {
        id: string;
        username: string;
        avatar: string;
    };
    attachments: {
        secureUrl: string;
    }[];
    replyToMessage: {
        id: string;
        textMessageContent: string | null;
        url: string | null;
        isPollMessage: boolean;
        audioUrl: string | null;
        sender: {
            id: string;
            username: string;
            avatar: string;
        };
        attachments: {
            secureUrl: string;
        }[];
    } | null;
    poll: ({
        votes: ({
            user: {
                id: string;
                username: string;
                avatar: string;
            };
            optionIndex: number;
        })[];
        question: string;
        options: string[];
        multipleAnswers: boolean;
    }) | null;
    reactions: {
        user: {
            id: string;
            username: string;
            avatar: string;
        };
        reaction: string;
    }[];
    id: string;
    isTextMessage: boolean;
    textMessageContent: string | null;
    chatId: string;
    url: string | null;
    isPollMessage: boolean;
    isEdited: boolean;
    audioUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
    isNew?:boolean
    isPinned:boolean

    // client side added variable
    // this does not comes from the server
    decryptedMessage?:string
}