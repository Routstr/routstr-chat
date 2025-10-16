import { useRef, useEffect, useState } from 'react';
import { ImagePlus, Loader2, Send, X } from 'lucide-react';
import { useChat } from '@/context/ChatProvider';

interface ChatInputProps {
  inputMessage: string;
  setInputMessage: (message: string) => void;
  uploadedImages: string[];
  setUploadedImages: React.Dispatch<React.SetStateAction<string[]>>;
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
  uploadedImages,
  setUploadedImages,
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
  useEffect(() => {
    if (!textareaRef.current) return;
    const textarea = textareaRef.current;
    if (inputMessage === '') {
      textarea.style.height = '48px';
      setTextareaHeight(48);
      return;
    }
    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, maxTextareaHeight);
    textarea.style.height = newHeight + 'px';
    setTextareaHeight(newHeight);
  }, [inputMessage, maxTextareaHeight, setTextareaHeight]);

  const handleSendMessage = () => {
    if (isCentered) {
      // Don't trigger multiple animations - let the useEffect handle it
      sendMessage();
    } else {
      sendMessage();
    }
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    const newImages: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith('image/')) {
        try {
          const base64 = await convertFileToBase64(file);
          newImages.push(base64);
        } catch (error) {
          console.error('Error converting file to base64:', error);
        }
      }
    }

    setUploadedImages((prev: string[]) => [...prev, ...newImages]);

    // Reset the input value to allow uploading the same file again
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

  const removeImage = (index: number) => {
    setUploadedImages((prev: string[]) => prev.filter((_: string, i: number) => i !== index));
  };

  return (
    <>
      {/* Greeting message when centered */}
      {(isCentered || isAnimating) && (
        <div 
          className={`fixed z-20 flex flex-col items-center justify-center transition-all duration-500 ease-out pointer-events-none ${
            isMobile || !isAuthenticated ? 'inset-0' : isSidebarCollapsed ? 'inset-0' : 'left-72 right-0 top-0 bottom-0'
          }`}
          style={{
            transform: isMobile ? 'translateY(-16px)' : 'translateY(-40px)',
            opacity: isCentered && !isAnimating ? 1 : 0
          }}
        >
          <div className="text-center mb-2">
            <h1 className="text-2xl md:text-3xl font-semibold text-white">
              How can I help?
            </h1>
          </div>
        </div>
      )}

      {/* Chat Input Container */}
        <div 
        className={`${
          isCentered && !isMobile
            ? `fixed z-20 flex items-center justify-center transition-all duration-500 ease-out ${
                !isAuthenticated ? 'inset-0' : isSidebarCollapsed ? 'inset-0' : 'left-72 right-0 top-0 bottom-0'
              }`
              : `${
                isMobile
                  ? `fixed z-20 bottom-0 left-0 right-0 w-screen ${unifiedBgClass} backdrop-blur-sm transition-all duration-300 ease-in-out px-0 pb-2 pt-0`
                  : 'fixed z-20 bottom-0 bg-[#181818] backdrop-blur-sm transition-all duration-300 ease-in-out ' + (!isAuthenticated ? 'left-0 right-0 pb-4 pt-0' : isSidebarCollapsed ? 'left-0 right-0 pb-4 pt-0' : 'left-72 right-0 pb-4 pt-0')
              }`
        }`}
        style={{
          transform: isCentered && !isMobile
            ? 'translateY(38px)'
            : 'translateY(0)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          bottom: !isCentered ? (isMobile ? '0px' : '16px') : undefined
        }}
      >
        <div className={`${isMobile ? 'w-full max-w-none px-4 pb-3' : 'mx-auto w-full ' + (isCentered ? 'max-w-[38rem]' : 'max-w-[44rem]') + ' px-4 sm:px-6 lg:px-0'}`}>
          {/* Image Preview */}
          {uploadedImages.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {uploadedImages.map((image, index) => (
                <div key={index} className="relative group">
                  <img
                    src={image}
                    alt={`Upload ${index + 1}`}
                    className="w-16 h-16 object-cover rounded-lg border border-white/10"
                  />
                  <button
                    onClick={() => removeImage(index)}
                    className="absolute -top-1 -right-1 bg-red-500 hover:bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="relative flex items-end w-full">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageUpload}
              className="hidden"
            />

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
              className="flex-1 bg-white/10 rounded-3xl px-4 py-3 text-[16.5px] sm:text-[16.5px] text-white focus:outline-none pl-14 pr-12 resize-none min-h-[48px] overflow-y-auto"
              autoComplete="off"
              data-tutorial="chat-input"
              rows={1}
              style={{
                height: 'auto',
                minHeight: '48px',
                maxHeight: maxTextareaHeight,
                fontSize: '16px' // prevent iOS zoom
              }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                const newHeight = Math.min(target.scrollHeight, maxTextareaHeight);
                target.style.height = newHeight + 'px';
                setTextareaHeight(newHeight);
              }}
            />

            {/* Image upload button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={!isAuthenticated}
              className={`absolute left-3 p-2 rounded-full bg-transparent hover:bg-white/10 md:hover:bg-white/20 disabled:opacity-50 disabled:bg-transparent transition-colors cursor-pointer ${textareaHeight <= 48 ? 'top-1/2 transform -translate-y-1/2' : 'bottom-2'}`}
              aria-label="Upload image"
            >
              <ImagePlus className="h-5 w-5 text-white" />
            </button>

            {/* Send button */}
            <button
              onClick={handleSendMessage}
              disabled={isLoading || (!isAuthenticated && !inputMessage.trim() && uploadedImages.length === 0)}
              className={`absolute right-3 p-2 rounded-full bg-transparent hover:bg-white/10 md:hover:bg-white/20 disabled:opacity-50 disabled:bg-transparent transition-colors cursor-pointer ${textareaHeight <= 48 ? 'top-1/2 transform -translate-y-1/2' : 'bottom-2'}`}
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