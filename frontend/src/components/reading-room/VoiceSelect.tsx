import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { BASE_VOICE_NAME, BASE_VOICE_OPTION } from "./hooks/useVoiceChoice";
import { usePlayback } from "./ReadingRoomContext";

export const VoiceSelect = () => {
  const { voiceSelectValue, setVoiceChoice, isLoadingPersonas, personas } = usePlayback();

  return (
    <Select value={voiceSelectValue} onValueChange={setVoiceChoice} disabled={isLoadingPersonas}>
      <SelectTrigger className="h-8 w-40 text-xs" aria-label="Reading voice">
        <SelectValue placeholder="Voice" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={BASE_VOICE_OPTION}>Base voice ({BASE_VOICE_NAME})</SelectItem>
        {personas?.map(persona => (
          <SelectItem key={persona.id} value={persona.id}>
            {persona.name}{persona.is_default ? " (default)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
