'use client';

import MarkdownRenderer from './MarkdownRenderer';
import { downloadImageFromSrc } from '../utils/download';

interface MessageContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
  };
}

interface MessageContentProps {
  content: string | MessageContent[];
}

export default function MessageContentRenderer({ content }: MessageContentProps) {
  if (typeof content === 'string') {
    return <MarkdownRenderer content={content} />;
  }

  // Count the number of images
  const imageCount = content.filter(item => item.type === 'image_url').length;

  // Separate text and images
  const textContent = content.filter(item => item.type === 'text');
  const imageContent = content.filter(item => item.type === 'image_url');

  return (
    <div className="space-y-2">
      {/* Render text content first */}
      {textContent.map((item, index) => (
        <MarkdownRenderer key={`text-${index}`} content={item.text || ''} />
      ))}

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