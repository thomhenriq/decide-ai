export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  type?: 'text' | 'audio' | 'image';
  image?: ImageAttachment;
  audio?: {
    id: string;
    mimeType: string;
    durationSeconds?: number;
    transcriptionStatus: 'pending' | 'completed' | 'error';
    transcriptionError?: string;
  };
}

export interface Conversation {
  id: string;
  messages: Message[];
}

export interface ImageAttachment {
  id: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  size: number;
  originalName: string;
  url: string;
  relativePath: string;
}

export interface MessageSentPayload {
  conversationId: string;
  message: Message;
  history: Message[];
}

export interface ChatBridge {
  receiveMessage: (text: string) => void;
  setTyping: (typing: boolean) => void;
}

declare global {
  interface Window {
    chat: ChatBridge;
  }
}
