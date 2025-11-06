import { Button } from "./ui/button";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { useState, useEffect } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { Card } from "./ui/card";
import { ChatWindow } from "./ChatWindow";
import { NotesWindow } from "./NotesWindow";
import { useUI } from "../contexts/UIContext";

export const AIAssistant = () => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { isAICollapsed, setIsAICollapsed, isMobile } = useUI();

  // Keep local and context state in sync
  useEffect(() => {
    setIsCollapsed(isAICollapsed);
  }, [isAICollapsed]);

  return (
    <Card className={`glass bg-card/95 shadow-lg 
      fixed z-50
      ${isCollapsed 
        ? 'w-[50px] right-4 top-4 h-[calc(100vh-2rem)]'
        : `
          sm:w-[calc(35vw-6rem)] sm:right-8 sm:top-4 sm:h-[calc(100vh-4rem)] sm:bottom-2
          lg:h-[calc(100vh-4rem)] lg:bottom-2 sm:max-w-[600px]
          w-full h-full right-0 top-0
        `
      }
  transition-[width,transform,opacity] duration-300 ease-in-out
  px-2 pt-2 pb-0 sm:px-3 sm:pt-3 sm:pb-0 lg:px-4 lg:pt-4 lg:pb-0 flex flex-col gap-4 animate-fade-in overflow-hidden`}>
      
      {/* Update the collapsed icon button */}
      <div className={`absolute inset-0 flex items-center justify-center
        transition-opacity duration-300 ease-in-out
        ${isCollapsed ? 'opacity-100 delay-150 bg-card/95' : 'opacity-0 pointer-events-none'}
        ${isMobile ? 'top-auto h-14 bg-card shadow-lg' : ''}`}>
        <Button 
          variant="ghost"
          size="icon"
          className="hover:bg-transparent"
          onClick={() => {
            setIsAICollapsed(false);
            setIsCollapsed(false);
          }}
        >
          <MessageSquare className={`${isMobile ? 'h-5 w-5' : 'h-6 w-6'}`} />
        </Button>
      </div>

      <Collapsible open={!isCollapsed} className="flex-1 min-h-0 overflow-hidden">
        <CollapsibleContent className="h-full">
          <Tabs defaultValue="chat" className="h-full flex flex-col">
            <div className="flex items-center gap-2 border-b pb-2 mb-4 flex-shrink-0">
              <TabsList className="flex-1 grid grid-cols-2 bg-background/50 rounded-lg">
                <TabsTrigger value="chat" className="flex items-center justify-center gap-2 text-sm sm:text-base">Chat</TabsTrigger>
                <TabsTrigger value="notes" className="flex items-center justify-center gap-2 text-sm sm:text-base">Notes</TabsTrigger>
              </TabsList>
              <CollapsibleTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 shrink-0 sm:hover:bg-background/80"
                  onClick={() => setIsAICollapsed(!isAICollapsed)}
                >
                  <ArrowLeft className={`h-4 w-4 transition-transform ${isCollapsed ? 'rotate-180' : ''}`} />
                </Button>
              </CollapsibleTrigger>
            </div>

            <TabsContent value="chat" className="flex-1 min-h-0 overflow-hidden mt-0 data-[state=active]:flex data-[state=active]:flex-col">
              <ChatWindow />
            </TabsContent>

            <TabsContent value="notes" className="flex-1 min-h-0 overflow-hidden mt-0 data-[state=active]:flex data-[state=active]:flex-col">
              <NotesWindow />
            </TabsContent>
          </Tabs>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};
