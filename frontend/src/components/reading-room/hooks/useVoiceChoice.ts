import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { voicePersonaService } from "@/services/voicePersonaService";

export const BASE_VOICE_NAME = 'Zephyr';
export const BASE_VOICE_OPTION = 'base-voice';

export const useVoiceChoice = () => {
  // Voice selection: null follows the user's default persona, BASE_VOICE_OPTION forces the base voice
  const [voiceChoice, setVoiceChoice] = useState<string | null>(null);
  const { data: personas, isLoading: isLoadingPersonas } = useQuery({
    queryKey: ['voice-personas', 'my'],
    queryFn: voicePersonaService.getMyPersonas,
    retry: false
  });
  const defaultPersona = personas?.find(p => p.is_default);
  const chosenPersona = personas?.find(p => p.id === voiceChoice);
  const activePersonaId =
    voiceChoice === BASE_VOICE_OPTION ? null : (chosenPersona ?? defaultPersona)?.id ?? null;
  const voiceSelectValue = activePersonaId ?? BASE_VOICE_OPTION;
  // Read at request time so prefetch and playback always use the latest selection
  const activePersonaIdRef = useRef<string | null>(null);
  activePersonaIdRef.current = activePersonaId;

  return {
    setVoiceChoice,
    personas,
    isLoadingPersonas,
    activePersonaId,
    voiceSelectValue,
    activePersonaIdRef,
  };
};
