export type MessageContentType = "text" | "image_url" | "file";

export interface AnnotationData {
  type: "url_citation";
  start_index: number;
  end_index: number;
  url: string;
  title: string;
}

export interface MessageContent {
  type: MessageContentType;
  text?: string;
  image_url?: {
    url: string;
    storageId?: string;
    blossomHash?: string; // SHA-256 of encrypted blob for cross-device sync
    blossomServers?: string[]; // Blossom servers where blob is stored
  };
  file?: {
    url: string;
    name?: string;
    mimeType?: string;
    size?: number;
    storageId?: string;
    blossomHash?: string; // SHA-256 of encrypted blob for cross-device sync
    blossomServers?: string[]; // Blossom servers where blob is stored
  };
  hidden?: boolean;
  thinking?: string;
  citations?: string[];
  annotations?: AnnotationData[];
}

export interface Message {
  role: string;
  content: string | MessageContent[];
  _eventId?: string;
  _prevId?: string;
  _createdAt?: number;
  _modelId?: string;
  satsSpent?: number;
}

export type AttachmentType = "image" | "file";

export interface MessageAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
  type: AttachmentType;
  textContent?: string;
  storageId?: string;
  blossomHash?: string; // SHA-256 of encrypted blob for cross-device sync
  blossomServers?: string[]; // Blossom servers where blob is stored
  blossomUploadStatus?: "pending" | "uploading" | "success" | "failed";
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
  type: "spent" | "mint" | "send" | "import" | "refund";
  amount: number;
  timestamp: number;
  status: "success" | "failed";
  model?: string;
  message?: string;
  balance?: number;
}
