'use client';

import MarkdownRenderer from './MarkdownRenderer';
import { downloadImageFromSrc } from '../utils/download';
import { FileText } from 'lucide-react';
import type { MessageContent as ChatMessageContent } from '@/types/chat';

interface MessageContentProps {
  content: string | ChatMessageContent[];
}

export default function MessageContentRenderer({ content }: MessageContentProps) {
  if (typeof content === 'string') {
    return <MarkdownRenderer content={content} />;
  }

  const getAttachmentLabel = (mimeType?: string): string | null => {
    if (!mimeType) return null;
    if (mimeType === 'application/pdf') return 'PDF';
    if (mimeType.startsWith('image/')) {
      return mimeType.replace('image/', '').toUpperCase();
    }
    return mimeType.toUpperCase();
  };

  // Count the number of images
  const imageContent = content.filter(item => item.type === 'image_url');
  const imageCount = imageContent.length;

  // Separate text, image, and file content
  const textContent = content.filter(item => item.type === 'text' && !item.hidden);
  const fileContent = content.filter(item => item.type === 'file');

  return (
    <div className="space-y-2">
      {/* Render text content first */}
      {textContent.map((item, index) => (
        <MarkdownRenderer key={`text-${index}`} content={item.text || ''} />
      ))}

      {/* Render file attachments */}
      {fileContent.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {fileContent.map((item, index) => {
            const label = getAttachmentLabel(item.file?.mimeType);
            return (
              <div
                key={`file-${index}`}
                className="flex w-[220px] max-w-full h-16 items-center gap-3 rounded-xl border border-white/15 bg-white/10 px-3 py-2"
              >
                <FileText className="h-5 w-5 text-white/80 flex-shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white" title={item.file?.name || 'Attachment'}>
                    {item.file?.name || 'Attachment'}
                  </p>
                  {label && (
                    <p className="text-xs uppercase text-white/60">{label}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Render images in a flex container */}
      {imageContent.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {imageContent.map((item, index) => (
            <img
              key={`image-${index}`}
              src={item.image_url?.url}
              alt="Image"
              className="w-16 h-16 object-cover rounded-lg border border-white/10"
            />
          ))}
        </div>
      )}
    </div>
  );
} 
