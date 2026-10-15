import { ContentLayout } from "@/components/layouts/ContentLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import {
  Play,
  Pause,
  Volume2,
  Settings,
  Plus,
  Heart,
  AudioWaveform,
  User,
  Crown,
  Zap,
  Loader2,
  Trash2,
  Edit
} from "lucide-react";
import { useState, MouseEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { voicePersonaService } from "@/services/voicePersonaService";
import { VoicePersona } from "@/types/voicePersona";
import { VoiceCreationModal } from "@/components/voice/VoiceCreationModal";
import { toast } from "sonner";

const VoiceStudio = () => {
  const queryClient = useQueryClient();
  const [currentlyPlaying, setCurrentlyPlaying] = useState<string | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingPersona, setEditingPersona] = useState<VoicePersona | null>(null);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);

  // --- Queries ---
  const { data: personas, isLoading } = useQuery({
    queryKey: ['voice-personas', 'my'],
    queryFn: voicePersonaService.getMyPersonas
  });

  const selectedVoice = personas?.find(p => p.id === selectedVoiceId) || personas?.[0];

  // --- Mutations ---
  const deleteMutation = useMutation({
    mutationFn: voicePersonaService.deletePersona,
    onSuccess: () => {
      toast.success("Persona deleted");
      queryClient.invalidateQueries({ queryKey: ['voice-personas'] });
    },
    onError: () => toast.error("Failed to delete persona")
  });

  const updateMutation = useMutation({
    mutationFn: (data: { id: string, updates: any }) =>
      voicePersonaService.updatePersona(data.id, data.updates),
    onSuccess: () => {
      toast.success("Persona updated");
      queryClient.invalidateQueries({ queryKey: ['voice-personas'] });
    }
  });

  // --- Handlers ---

  const handlePlayPreview = async (persona: VoicePersona) => {
    if (currentlyPlaying === persona.id && audioElement) {
      audioElement.pause();
      setCurrentlyPlaying(null);
      return;
    }

    if (currentlyPlaying && audioElement) {
      audioElement.pause();
    }

    // Prioritize stored preview URL if available
    let url = persona.preview_audio_url;

    if (!url) {
      // Fallback: Generate on the fly (might be slower)
      try {
        toast.loading("Generating preview...");
        const blob = await voicePersonaService.previewVoice({
          base_voice_name: persona.base_voice_name,
          pace: persona.pace,
          tone: persona.tone,
          emotion: persona.emotion
        });
        url = URL.createObjectURL(blob);
        toast.dismiss();
      } catch (e) {
        toast.error("Could not play preview");
        return;
      }
    }

    const audio = new Audio(url);
    setAudioElement(audio);
    setCurrentlyPlaying(persona.id);

    audio.play().catch(e => {
      console.error("Play error", e);
      toast.error("Playback failed");
    });

    audio.onended = () => setCurrentlyPlaying(null);
  };

  const handleDelete = async (e: MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this persona?")) {
      deleteMutation.mutate(id);
    }
  };

  const handleEdit = (e: MouseEvent, persona: VoicePersona) => {
    e.stopPropagation();
    setEditingPersona(persona);
    setIsCreateOpen(true);
  };

  const handleModalClose = (open: boolean) => {
    setIsCreateOpen(open);
    if (!open) setEditingPersona(null);
  };

  if (isLoading) {
    return (
      <ContentLayout title="Voice Studio" description="Loading your voices...">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </ContentLayout>
    );
  }

  return (
    <ContentLayout
      title="Voice Studio"
      description="Manage and customize your reading voices"
    >
      <div className="space-y-8">
        {/* Voice Gallery */}
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-xl font-semibold text-foreground">My Personas</h2>
            <Button className="gap-2" onClick={() => setIsCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Create New Persona
            </Button>
          </div>

          {!personas || personas.length === 0 ? (
            <div className="text-center py-12 bg-card border border-border rounded-md">
              <p className="text-muted-foreground mb-4">You haven't created any voice personas yet.</p>
              <Button onClick={() => setIsCreateOpen(true)}>Get Started</Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {personas.map((voice: VoicePersona) => (
                <Card
                  key={voice.id}
                  className={`shadow-none transition-colors cursor-pointer hover:border-primary/40 ${selectedVoice?.id === voice.id ? 'border-primary' : ''}`}
                  onClick={() => setSelectedVoiceId(voice.id)}
                >
                  <div className="p-4 space-y-4">
                    {/* Voice Header */}
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-muted rounded-md flex items-center justify-center">
                          <User className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-serif font-semibold text-foreground">{voice.name}</h3>
                            {voice.is_featured && (
                              <Crown className="h-4 w-4 text-primary" />
                            )}
                            {voice.total_usage_count > 100 && (
                              <Badge variant="secondary" className="text-xs">
                                <Zap className="h-3 w-3 me-1" />
                                Popular
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {voice.base_voice_name} • {voice.emotion}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Voice Description */}
                    <p className="text-sm text-muted-foreground line-clamp-2 min-h-[40px]">
                      {voice.description || "No description provided."}
                    </p>

                    {/* Tags */}
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="outline" className="text-xs">{voice.pace}</Badge>
                      <Badge variant="outline" className="text-xs">{voice.tone}</Badge>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 gap-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePlayPreview(voice);
                        }}
                      >
                        {currentlyPlaying === voice.id ? (
                          <Pause className="h-3 w-3" />
                        ) : (
                          <Play className="h-3 w-3" />
                        )}
                        Preview
                      </Button>
                      <Button size="sm" variant="ghost" className="px-2" onClick={(e) => handleEdit(e, voice)}>
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button size="sm" variant="ghost" className="px-2 text-destructive hover:text-destructive" onClick={(e) => handleDelete(e, voice.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Selected Voice Details */}
        {selectedVoice && (
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-6">
              <h2 className="font-serif text-xl font-semibold text-foreground">Selected Voice</h2>

              <Card className="shadow-none p-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 bg-muted rounded-md flex items-center justify-center">
                      <User className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold text-foreground">{selectedVoice.name}</h3>
                        {selectedVoice.is_default && <Badge>Default</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {selectedVoice.base_voice_name} • {selectedVoice.pace}
                      </p>
                    </div>
                  </div>

                  <p className="text-sm text-muted-foreground bg-muted p-3 rounded-md">
                    <strong>Prompt Logic:</strong> Read in a {selectedVoice.pace} pace, with a {selectedVoice.tone} tone and {selectedVoice.emotion} emotion.
                  </p>

                  <div className="flex gap-3 pt-4">
                    <Button
                      className="w-full gap-2"
                      onClick={() => handlePlayPreview(selectedVoice)}
                    >
                      {currentlyPlaying === selectedVoice.id ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      {currentlyPlaying === selectedVoice.id ? 'Stop' : 'Play Preview'}
                    </Button>
                    {!selectedVoice.is_default && (
                      <Button
                        variant="secondary"
                        className="w-full"
                        onClick={() => updateMutation.mutate({ id: selectedVoice.id, updates: { is_default: true } })}
                      >
                        Set as Default
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            </div>

            {/* Stats (Placeholder for now) */}
            <div className="space-y-6">
              <h2 className="font-serif text-xl font-semibold text-foreground">Usage</h2>
              <Card className="shadow-none p-6">
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Times Used</span>
                    <span className="text-foreground">{selectedVoice.total_usage_count}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Pages Read</span>
                    <span className="text-foreground">{selectedVoice.total_pages_read}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Rating</span>
                    <span className="text-foreground">{selectedVoice.average_rating || 'N/A'}</span>
                  </div>
                </div>
              </Card>
            </div>
          </section>
        )}

        {/* Coming Soon Features */}
        <section>
          <h2 className="font-serif text-xl font-semibold text-foreground mb-6">Coming Soon</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card className="shadow-none p-6 text-center">
              <AudioWaveform className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="font-semibold text-foreground mb-2">Voice Cloning</h3>
              <p className="text-sm text-muted-foreground">
                Create custom voices using AI voice cloning technology
              </p>
            </Card>

            <Card className="shadow-none p-6 text-center">
              <Volume2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="font-semibold text-foreground mb-2">Emotion Detection</h3>
              <p className="text-sm text-muted-foreground">
                Automatically adjust voice emotion based on content context
              </p>
            </Card>

            <Card className="shadow-none p-6 text-center">
              <Settings className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="font-semibold text-foreground mb-2">Advanced Controls</h3>
              <p className="text-sm text-muted-foreground">
                Fine-tune breathing, pauses, and pronunciation patterns
              </p>
            </Card>
          </div>
        </section>
      </div>

      <VoiceCreationModal
        open={isCreateOpen}
        onOpenChange={handleModalClose}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['voice-personas'] });
          setIsCreateOpen(false);
        }}
        initialData={editingPersona}
      />
    </ContentLayout>
  );
};

export default VoiceStudio;

