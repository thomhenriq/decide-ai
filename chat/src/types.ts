export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  messages: Message[];
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
