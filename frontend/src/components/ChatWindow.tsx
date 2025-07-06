import { useState, useRef, useEffect } from "react";
import { Card } from "./ui/card";
import { ScrollArea } from "./ui/scroll-area";
import { TextInput } from "./ui/text-input";
import { User, Bot, Upload } from "lucide-react";
import { Button } from "./ui/button";
import { toast } from "@/hooks/use-toast";

interface Message {
  id: string;
  content: string;
  sender: 'human' | 'assistant';
  timestamp: Date;
}

interface Cache {
  id: string;
  filename: string;
}

export const ChatWindow = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      content: "Hello! I'm your AI reading companion. I can help you understand PDF documents better. Please upload a PDF to start.",
      sender: "assistant",
      timestamp: new Date(),
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeCache, setActiveCache] = useState<Cache | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement>(null);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setIsLoading(true);
      
      // Create a FormData object to send the file
      const formData = new FormData();
      formData.append("file", file);

      // Send the file to the FastAPI backend
      const response = await fetch("http://localhost:8000/api/upload-pdf", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to upload PDF");
      }

      const data = await response.json();
      
      // Set the active cache
      setActiveCache({
        id: data.cache_id,
        filename: data.filename,
      });
      
      // Add a system message
      setMessages([
        ...messages,
        {
          id: Date.now().toString(),
          content: `Successfully uploaded "${data.filename}". You can now ask questions about this document!`,
          sender: "assistant",
          timestamp: new Date(),
        },
      ]);
      
      toast({
        title: "PDF Uploaded",
        description: `"${data.filename}" is ready for chat!`,
      });
      
    } catch (error) {
      console.error("Error uploading PDF:", error);
      toast({
        title: "Upload Failed",
        description: error instanceof Error ? error.message : "Failed to upload PDF",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleSubmit = async (content: string) => {
    // Add user message to the chat
    const userMessageId = Date.now().toString();
    
    setMessages(prevMessages => [
      ...prevMessages,
      {
        id: userMessageId,
        content,
        sender: "human",
        timestamp: new Date(),
      }
    ]);

    // If no PDF is uploaded yet, remind the user
    if (!activeCache) {
      setTimeout(() => {
        setMessages(prevMessages => [
          ...prevMessages,
          {
            id: (Date.now() + 1).toString(),
            content: "Please upload a PDF document first so I can answer questions about it.",
            sender: "assistant",
            timestamp: new Date(),
          }
        ]);
      }, 500);
      return;
    }

    try {
      setIsLoading(true);

      // Collect recent message history (optional - could be implemented for better context)
      const recentMessages = messages
        .slice(-10) // Get last 10 messages for context
        .map(msg => ({
          content: msg.content,
          role: msg.sender === "human" ? "user" : "assistant"
        }));

      // Send chat request to backend API
      const response = await fetch("http://localhost:8000/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cache_id: activeCache.id,
          message: content,
          history: recentMessages,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "Failed to get response");
      }

      const data = await response.json();
      
      // Add assistant response to chat
      setMessages(prevMessages => [
        ...prevMessages,
        {
          id: (Date.now() + 2).toString(),
          content: data.message,
          sender: "assistant",
          timestamp: new Date(),
        }
      ]);

    } catch (error) {
      console.error("Error sending message:", error);
      
      // Add error message to chat
      setMessages(prevMessages => [
        ...prevMessages,
        {
          id: (Date.now() + 3).toString(),
          content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : "Failed to get a response"}`,
          sender: "assistant",
          timestamp: new Date(),
        }
      ]);
      
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Scroll to bottom when messages change
    if (scrollViewportRef.current) {
      const scrollElement = scrollViewportRef.current;
      scrollElement.scrollTo({
        top: scrollElement.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages]);

  // Clean up the cache when component unmounts
  useEffect(() => {
    return () => {
      if (activeCache) {
        // Attempt to delete the cache
        fetch(`http://localhost:8000/api/cache/${activeCache.id}`, {
          method: "DELETE"
        }).catch(err => console.error("Failed to clean up cache:", err));
      }
    };
  }, [activeCache]);

  return (
    <div className="flex-1 h-full flex flex-col">
      <div className="flex-1 flex flex-col min-h-0 relative">
        {activeCache && (
          <div className="p-4 border-b flex items-center">
            <div className="text-sm font-medium text-primary">
              Active PDF: {activeCache.filename}
            </div>
          </div>
        )}
        
        <ScrollArea 
          className="h-[calc(100vh-240px)]"
          scrollHideDelay={0}
        >
          <div className="space-y-4 px-4 pb-4" ref={scrollViewportRef}>
            {messages.map((message) => (
              <Card key={message.id} className="p-3 lg:p-4 card-gradient">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 mt-1">
                    {message.sender === "human" ? (
                      <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                        <User className="h-4 w-4 text-primary" />
                      </div>
                    ) : (
                      <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                        <Bot className="h-4 w-4 text-primary" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 space-y-1">
                    <p className="text-sm text-muted-foreground">{message.content}</p>
                    <p className="text-xs text-muted-foreground/50">
                      {message.timestamp.toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
            {isLoading && (
              <Card className="p-3 lg:p-4 card-gradient animate-pulse">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 mt-1">
                    <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="h-4 bg-primary/10 rounded w-3/4 mb-2"></div>
                    <div className="h-4 bg-primary/10 rounded w-1/2"></div>
                  </div>
                </div>
              </Card>
            )}
          </div>
        </ScrollArea>
        <div className="sticky bottom-0 bg-background/80 backdrop-blur-sm border-t w-full">
          <TextInput
            placeholder={activeCache ? "Ask a question about the PDF..." : "Upload a PDF to start chatting..."}
            onMessageSubmit={handleSubmit}
          />
        </div>
      </div>
    </div>
  );
};
