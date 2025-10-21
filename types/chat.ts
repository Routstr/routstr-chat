export type MessageContentType = 'text' | 'image_url' | 'file';

export interface MessageContent {
  type: MessageContentType;
  text?: string;
  image_url?: {
    url: string;
  };
  file?: {
    url: string;
    name?: string;
    mimeType?: string;
    size?: number;
  };
  hidden?: boolean;
}

export interface Message {
  role: string;
  content: string | MessageContent[];
  thinking?: string;
}

export type AttachmentType = 'image' | 'file';

export interface MessageAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
  type: AttachmentType;
  textContent?: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
}

export interface Model {
  id: string;
  name: string;
  description?: string;
  sats_pricing: {
    completion: number;
    max_cost: number;
  };
} 

export interface TransactionHistory {
  type: 'spent' | 'mint' | 'send' | 'import' | 'refund';
  amount: number;
  timestamp: number;
  status: 'success' | 'failed';
  model?: string;
  message?: string;
  balance?: number;
}
