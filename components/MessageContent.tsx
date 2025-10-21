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
            <div key={`image-${index}`} className="relative group">
              <img
                src={item.image_url?.url}
                alt="Image"
                className={`${imageCount > 1 ? 'max-w-[200px] max-h-[200px]' : 'max-w-[300px] max-h-[300px]'} w-auto h-auto object-contain rounded-lg border border-white/10`}
              />
              {item.image_url?.url && (
                <button
                  type="button"
                  onClick={() => downloadImageFromSrc(item.image_url!.url)}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 hover:bg-black/80 text-white text-xs rounded-md px-2 py-1 border border-white/20"
                  aria-label="Download image"
                >
                  Download
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
} 
