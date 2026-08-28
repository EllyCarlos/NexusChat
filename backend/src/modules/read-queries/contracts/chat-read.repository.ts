import type { ChatReadRecord } from "./read-query.types.js";

export interface ChatReadRepository {
  listChatsForUser(userId: string): Promise<ChatReadRecord[]>;
}
