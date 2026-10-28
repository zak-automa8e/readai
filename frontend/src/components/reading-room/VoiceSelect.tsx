import { AudioLines, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "../ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { BASE_VOICE_NAME, BASE_VOICE_OPTION } from "./hooks/useVoiceChoice";
import { usePlayback } from "./ReadingRoomContext";

const CREATE_VOICE = "__create-voice__";

/** Who reads the book: the base voice or one of the reader's voice personas. */
export const VoiceSelect = () => {
  const { voiceSelectValue, setVoiceChoice, isLoadingPersonas, personas } = usePlayback();
  const navigate = useNavigate();

  const onChange = (value: string) => {
    if (value === CREATE_VOICE) navigate("/voices");
    else setVoiceChoice(value);
  };

  return (
    <Select value={voiceSelectValue} onValueChange={onChange} disabled={isLoadingPersonas}>
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger className="h-8 w-44 gap-1.5 text-xs" aria-label="Reading voice">
            <AudioLines className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-start">
              <SelectValue placeholder="Voice" />
            </span>
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">Reading voice: who reads the book to you</TooltipContent>
      </Tooltip>
      <SelectContent>
        <SelectItem value={BASE_VOICE_OPTION}>Base voice (<span dir="ltr">{BASE_VOICE_NAME}</span>)</SelectItem>
        {personas?.map(persona => (
          <SelectItem key={persona.id} value={persona.id}>
            <span dir="auto">{persona.name}</span>{persona.is_default ? " (default)" : ""}
          </SelectItem>
        ))}
        {!personas?.length && (
          <>
            <SelectSeparator />
            <SelectItem value={CREATE_VOICE}>
              <span className="flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Create a voice…
              </span>
            </SelectItem>
          </>
        )}
      </SelectContent>
    </Select>
  );
};
