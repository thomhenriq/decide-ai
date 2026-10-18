export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  type?: 'text' | 'audio' | 'image' | 'products';
  products?: ProductRecommendation[];
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

export interface UserLocation {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
}

export interface MessageSentPayload {
  conversationId: string;
  message: Message;
  history: Message[];
}

/** Payload enviado ao backend do agente: o do trigger mais a localização, quando autorizada. */
export interface AgentRequest extends MessageSentPayload {
  location?: UserLocation;
}

export interface ChatBridge {
  receiveMessage: (response: string | AgentResponse) => boolean;
  receiveAgentMessage: (response: string | AgentResponse) => boolean;
  setTyping: (typing: boolean) => void;
}

/** Contrato interno do resumo; no WhatsApp, o conteúdo será enviado como texto. */
export interface WeeklyInsight {
  type: 'weekly_insight';
  restaurantId: string;
  messageId: string;
  text: string;
}

export interface RestaurantChatBridge {
  receiveWeeklyInsight: (insight: WeeklyInsight) => boolean;
}

export interface ProductRecommendation {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  priceCents?: number;
  originalPriceCents?: number;
  restaurant: {
    id?: string;
    name: string;
    rating?: number;
    ratingCount?: number;
  };
  delivery?: {
    feeCents?: number;
    minMinutes?: number;
    maxMinutes?: number;
  };
  url?: string;
}

interface AgentResponseMetadata {
  conversationId?: string;
  messageId?: string;
}

export type AgentResponse = AgentResponseMetadata & (
  | { type: 'text'; text: string }
  | { type: 'products'; text?: string; products: ProductRecommendation[] }
);

declare global {
  interface Window {
    chat: ChatBridge;
    restaurantChat: RestaurantChatBridge;
  }
}
