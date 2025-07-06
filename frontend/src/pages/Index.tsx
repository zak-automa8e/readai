import { ReadingArea } from "@/components/ReadingArea";
import { AIAssistant } from "@/components/AIAssistant";
import { BackToLibrary } from "@/components/BackToLibrary";

export default function Index() {
  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <BackToLibrary />
      <ReadingArea />
      <AIAssistant />
    </div>
  );
}
