import { useRef, useEffect, useState } from 'react';
import { FileText, Loader2, Paperclip, Send, X } from 'lucide-react';
import { useChat } from '@/context/ChatProvider';
import { MessageAttachment } from '@/types/chat';
import { extractTextFromPdf } from '@/utils/pdfUtils';

interface ChatInputProps {
  inputMessage: string;
  setInputMessage: (message: string) => void;
  uploadedAttachments: MessageAttachment[];
  setUploadedAttachments: React.Dispatch<React.SetStateAction<MessageAttachment[]>>;
  sendMessage: () => void;
  isLoading: boolean;
  isAuthenticated: boolean;
  textareaHeight: number;
  setTextareaHeight: (height: number) => void;
  isSidebarCollapsed: boolean;
  isMobile: boolean;
  hasMessages: boolean;
}

export default function ChatInput({
  inputMessage,
  setInputMessage,
  uploadedAttachments,
  setUploadedAttachments,
  sendMessage,
  isLoading,
  isAuthenticated,
  textareaHeight,
  setTextareaHeight,
  isSidebarCollapsed,
  isMobile,
  hasMessages
}: ChatInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isCentered, setIsCentered] = useState(!hasMessages);
  const { isSidebarOpen } = useChat();
  const unifiedBgClass = isMobile && isSidebarOpen ? 'bg-[#181818]' : 'bg-[#181818]';
  const maxTextareaHeight = isMobile ? 176 : 240;

  // Handle animation when messages change from external updates
  useEffect(() => {
    // Center when no messages, bottom when messages exist (both mobile and desktop)
    if (hasMessages && isCentered) {
      setIsAnimating(true);
      setIsCentered(false);
      // Clean up animation after completion
      setTimeout(() => setIsAnimating(false), 600);
    } else if (!hasMessages && !isCentered) {
      setIsCentered(true);
      setIsAnimating(false);
    }
  }, [hasMessages, isCentered]);

  // Keep textarea height in sync with content and clamp to max height
  // Also account for attachment preview height (if any)
  useEffect(() => {
    if (!textareaRef.current) return;
    const textarea = textareaRef.current;
    let textareaOnlyHeight = 48;
    
    if (inputMessage === '') {
      textarea.style.height = '48px';
      textareaOnlyHeight = 48;
    } else {
      textarea.style.height = 'auto';
      textareaOnlyHeight = Math.min(textarea.scrollHeight, maxTextareaHeight);
      textarea.style.height = textareaOnlyHeight + 'px';
    }
    
    // Calculate total input container height including attachments
    // Attachment row adds ~88px (64px height + 12px top padding + 8px bottom padding + 4px bottom margin)
    const attachmentHeight = uploadedAttachments.length > 0 ? 88 : 0;
    const totalHeight = textareaOnlyHeight + attachmentHeight;
    setTextareaHeight(totalHeight);
  }, [inputMessage, maxTextareaHeight, setTextareaHeight, uploadedAttachments.length]);

  const handleSendMessage = () => {
    if (isCentered) {
      // Don't trigger multiple animations - let the useEffect handle it
      sendMessage();
    } else {
      sendMessage();
    }
  };

  const createAttachmentId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  };

  const getAttachmentLabel = (mimeType: string) => {
    if (mimeType === 'application/pdf') return 'PDF';
    if (mimeType.startsWith('image/')) {
      return mimeType.replace('image/', '').toUpperCase();
    }
    return mimeType.toUpperCase();
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const acceptedMimeTypes = ['application/pdf'];
    const attachmentsToAdd: { attachment: MessageAttachment; file: File }[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isImage = file.type.startsWith('image/');
      const isAcceptedFile = acceptedMimeTypes.includes(file.type);

      if (!isImage && !isAcceptedFile) continue;

      try {
        const dataUrl = await convertFileToBase64(file);
        const attachment: MessageAttachment = {
          id: createAttachmentId(),
          name: file.name,
          mimeType: file.type,
          size: file.size,
          dataUrl,
          type: isImage ? 'image' : 'file'
        };

        attachmentsToAdd.push({ attachment, file });
      } catch (error) {
        console.error('Error converting file to base64:', error);
      }
    }

    if (attachmentsToAdd.length > 0) {
      setUploadedAttachments((prev) => [
        ...prev,
        ...attachmentsToAdd.map(item => item.attachment)
      ]);

      attachmentsToAdd.forEach(({ attachment, file }) => {
        if (attachment.mimeType === 'application/pdf') {
          extractTextFromPdf(file)
            .then(text => {
              if (!text.trim()) return;
              setUploadedAttachments(prev =>
                prev.map(item =>
                  item.id === attachment.id ? { ...item, textContent: text } : item
                )
              );
            })
            .catch(error => {
              console.warn('Failed to extract text from PDF attachment, continuing without text content.', error);
            });
        }
      });
    }

    if (event.target) {
      event.target.value = '';
    }
  };

  const convertFileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  const removeAttachment = (id: string) => {
    setUploadedAttachments((prev) => prev.filter((item) => item.id !== id));
  };

  return (
    <>
      {/* Greeting message when centered */}
      {(isCentered || isAnimating) && (
        <div 
          className={`fixed z-20 flex flex-col items-center transition-all duration-500 ease-out pointer-events-none ${
            isMobile || !isAuthenticated ? 'inset-x-0' : isSidebarCollapsed ? 'inset-x-0' : 'left-72 right-0'
          }`}
          style={{
            top: '50%',
            transform: isMobile ? 'translateY(calc(-50% - 100px))' : 'translateY(calc(-50% - 120px))',
            opacity: isCentered && !isAnimating ? 1 : 0
          }}
        >
          <div className="text-center mb-4">
            <h1 className="text-2xl md:text-3xl font-semibold text-white">
              How can I help?
            </h1>
          </div>
        </div>
      )}

      {/* Chat Input Container */}
        <div 
        className={`${
          isCentered
            ? `fixed z-20 flex items-start justify-center transition-all duration-500 ease-out ${
                isMobile || !isAuthenticated ? 'inset-x-0' : isSidebarCollapsed ? 'inset-x-0' : 'left-72 right-0'
              } ${isMobile ? `w-screen ${unifiedBgClass} backdrop-blur-sm px-0 pb-2 pt-0` : ''}`
              : `${
                isMobile
                  ? `fixed z-20 left-0 right-0 w-screen ${unifiedBgClass} backdrop-blur-sm transition-all duration-300 ease-in-out px-0 pb-2 pt-0`
                  : 'fixed z-20 bg-[#181818] backdrop-blur-sm transition-all duration-300 ease-in-out ' + (!isAuthenticated ? 'left-0 right-0 pb-4 pt-0' : isSidebarCollapsed ? 'left-0 right-0 pb-4 pt-0' : 'left-72 right-0 pb-4 pt-0')
              }`
        }`}
        style={{
          top: isCentered ? (isMobile ? 'calc(50% - 40px)' : 'calc(50% - 56px)') : undefined,
          bottom: isCentered ? undefined : (isMobile ? '0px' : '16px'),
          paddingBottom: 'env(safe-area-inset-bottom)'
        }}
      >
        <div className={`${isMobile ? 'w-full max-w-none px-4 pb-3' : 'mx-auto w-full ' + (isCentered ? 'max-w-[38rem]' : 'max-w-[44rem]') + ' px-4 sm:px-6 lg:px-0'}`}>
          {/* Unified Input Container with Attachment Preview Inside */}
          <div className="relative flex flex-col w-full bg-white/10 rounded-3xl transition-all duration-300 ease-out">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              onChange={handleFileUpload}
              className="hidden"
            />

            {/* Attachment Preview - First Row */}
            {uploadedAttachments.length > 0 && (
              <div className="flex flex-wrap gap-2 px-4 pt-3 pb-2 animate-in fade-in slide-in-from-top-2 duration-300">
                {uploadedAttachments.map((attachment, index) => (
                  <div 
                    key={attachment.id} 
                    className="relative group animate-in fade-in zoom-in-95 duration-200"
                    style={{ 
                      animationDelay: `${index * 50}ms`,
                      animationFillMode: 'backwards'
                    }}
                  >
                    {attachment.type === 'image' ? (
                      <img
                        src={attachment.dataUrl}
                        alt={attachment.name}
                        className="w-16 h-16 object-cover rounded-lg border border-white/10"
                      />
                    ) : (
                      <div className="flex w-[220px] max-w-full h-16 items-center gap-3 rounded-xl border border-white/15 bg-white/10 px-3 py-2">
                        <FileText className="h-5 w-5 text-white/80 flex-shrink-0" aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-white" title={attachment.name}>
                            {attachment.name}
                          </p>
                          <p className="text-xs uppercase text-white/60">{getAttachmentLabel(attachment.mimeType)}</p>
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() => removeAttachment(attachment.id)}
                      className={`absolute -top-1 -right-1 bg-red-500 hover:bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs transition-opacity duration-150 ${
                        isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Textarea and Buttons - Second Row */}
            <div className="relative flex items-center w-full pb-1">
              <textarea
                ref={textareaRef}
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder={isAuthenticated ? (isCentered ? `Type your message...` : `Ask anything...`) : `Sign in to start chatting...`}
                className="flex-1 bg-transparent px-4 py-3 text-[16.5px] sm:text-[16.5px] text-white focus:outline-none pl-14 pr-12 resize-none min-h-[48px] overflow-y-auto"
                autoComplete="off"
                data-tutorial="chat-input"
                rows={1}
                style={{
                  height: 'auto',
                  minHeight: '48px',
                  maxHeight: maxTextareaHeight,
                  fontSize: '16px'
                }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = 'auto';
                  const textareaOnlyHeight = Math.min(target.scrollHeight, maxTextareaHeight);
                  target.style.height = textareaOnlyHeight + 'px';
                  // Include attachment height in total height
                  const attachmentHeight = uploadedAttachments.length > 0 ? 88 : 0;
                  setTextareaHeight(textareaOnlyHeight + attachmentHeight);
                }}
              />

              {/* Attachment upload button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={!isAuthenticated}
                className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-transparent hover:bg-white/10 md:hover:bg-white/20 disabled:opacity-50 disabled:bg-transparent transition-colors cursor-pointer"
                aria-label="Upload attachment"
              >
                <Paperclip className="h-5 w-5 text-white" />
              </button>

              {/* Send button */}
              <button
                onClick={handleSendMessage}
                disabled={isLoading || (!isAuthenticated && !inputMessage.trim() && uploadedAttachments.length === 0)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-transparent hover:bg-white/10 md:hover:bg-white/20 disabled:opacity-50 disabled:bg-transparent transition-colors cursor-pointer"
                aria-label="Send message"
              >
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-white" />
                ) : (
                  <Send className="h-5 w-5 text-white" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
      {/* Bottom spacer for visible padding below the input */}
      {!isCentered && (
        <div
          className={`fixed bottom-0 z-20 pointer-events-none ${
            !isAuthenticated ? 'left-0 right-0' : isSidebarCollapsed ? 'left-0 right-0' : 'left-72 right-0'
          } ${isMobile ? 'h-3' : 'h-4'} ${unifiedBgClass}`}
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        />
      )}
    </>
  );
} 
