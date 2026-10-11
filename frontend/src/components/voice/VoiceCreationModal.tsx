import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Play, Pause, Loader2, Save } from "lucide-react";
import { voicePersonaService } from "@/services/voicePersonaService";
import { VoicePersona } from "@/types/voicePersona";
import { toast } from "sonner";

interface VoiceCreationModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
    initialData?: VoicePersona | null; // If editing
}

export const VoiceCreationModal = ({ open, onOpenChange, onSuccess, initialData }: VoiceCreationModalProps) => {
    const [loading, setLoading] = useState(false);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

    const [formData, setFormData] = useState<{
        name: string;
        description: string;
        base_voice_name: string;
        pace: VoicePersona['pace'];
        tone: VoicePersona['tone'];
        emotion: VoicePersona['emotion'];
    }>({
        name: "",
        description: "",
        base_voice_name: "Enceladus",
        pace: "normal",
        tone: "neutral",
        emotion: "calm"
    });

    // Reset form when opening
    useEffect(() => {
        if (open) {
            if (initialData) {
                setFormData({
                    name: initialData.name,
                    description: initialData.description || "",
                    base_voice_name: initialData.base_voice_name,
                    pace: initialData.pace,
                    tone: initialData.tone,
                    emotion: initialData.emotion
                });
            } else {
                setFormData({
                    name: "",
                    description: "",
                    base_voice_name: "Enceladus",
                    pace: "normal",
                    tone: "neutral",
                    emotion: "calm"
                });
            }
            setAudioUrl(null);
        }
    }, [open, initialData]);

    // Handle Play/Stop Preview
    const handlePreview = async () => {
        if (isPlaying && audioElement) {
            audioElement.pause();
            audioElement.currentTime = 0;
            setIsPlaying(false);
            return;
        }

        if (audioUrl) {
            const audio = new Audio(audioUrl);
            setAudioElement(audio);
            audio.onended = () => setIsPlaying(false);
            audio.play();
            setIsPlaying(true);
            return;
        }

        try {
            setPreviewLoading(true);
            const blob = await voicePersonaService.previewVoice({
                base_voice_name: formData.base_voice_name,
                pace: formData.pace,
                tone: formData.tone,
                emotion: formData.emotion
            });

            setAudioBlob(blob); // Store for saving
            const url = URL.createObjectURL(blob);
            setAudioUrl(url);

            const audio = new Audio(url);
            setAudioElement(audio);
            audio.onended = () => setIsPlaying(false);
            audio.play();
            setIsPlaying(true);
        } catch (error: any) {
            if (error.message === 'Rate limit exceeded' || error.status === 429) {
                toast.error("Daily preview limit reached. Please try again tomorrow.");
            } else {
                toast.error("Failed to generate preview");
            }
            console.error(error);
        } finally {
            setPreviewLoading(false);
        }
    };

    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);

    // Helpers
    const blobToBase64 = (blob: Blob): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64String = reader.result as string;
                // Remove data url prefix (e.g. "data:audio/wav;base64,")
                const base64 = base64String.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    };

    const handleSave = async () => {
        if (!formData.name) {
            toast.error("Please enter a persona name");
            return;
        }

        try {
            setLoading(true);

            let preview_audio: string | undefined;
            if (audioBlob) {
                preview_audio = await blobToBase64(audioBlob);
            }

            const payload = { ...formData, preview_audio };

            if (initialData) {
                await voicePersonaService.updatePersona(initialData.id, payload);
                toast.success("Persona updated!");
            } else {
                await voicePersonaService.createPersona(payload);
                toast.success("Persona created!");
            }
            onSuccess();
            onOpenChange(false);
        } catch (error) {
            toast.error("Failed to save persona");
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    // When settings change, clear previous preview
    const handleChange = (field: string, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        if (field !== 'name' && field !== 'description') {
            setAudioUrl(null); // Invalidate preview
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>{initialData ? "Edit Persona" : "Create New Persona"}</DialogTitle>
                    <DialogDescription>
                        Customize your AI reading voice. Adjust pace, tone, and emotion.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">Name</Label>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={(e) => handleChange('name', e.target.value)}
                                placeholder="e.g. My Narrator"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="base">Base Voice</Label>
                            <Select
                                value={formData.base_voice_name}
                                onValueChange={(v) => handleChange('base_voice_name', v)}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Enceladus">Enceladus (General)</SelectItem>
                                    <SelectItem value="Lapetus">Lapetus (Calm)</SelectItem>
                                    <SelectItem value="Algieba">Algieba (Expressive)</SelectItem>
                                    <SelectItem value="Algenib">Algenib (Professional)</SelectItem>
                                    <SelectItem value="Alnilam">Alnilam (Authoritative)</SelectItem>
                                    <SelectItem value="Schedar">Schedar (Warm)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="description">Description (Optional)</Label>
                        <Input
                            id="description"
                            value={formData.description}
                            onChange={(e) => handleChange('description', e.target.value)}
                            placeholder="Briefly describe this persona..."
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Pace</Label>
                            <Select value={formData.pace} onValueChange={(v) => handleChange('pace', v)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="slow">Slow</SelectItem>
                                    <SelectItem value="normal">Normal</SelectItem>
                                    <SelectItem value="fast">Fast</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Tone</Label>
                            <Select value={formData.tone} onValueChange={(v) => handleChange('tone', v)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="neutral">Neutral</SelectItem>
                                    <SelectItem value="warm">Warm</SelectItem>
                                    <SelectItem value="professional">Professional</SelectItem>
                                    <SelectItem value="dramatic">Dramatic</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Emotion</Label>
                        <Select value={formData.emotion} onValueChange={(v) => handleChange('emotion', v)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="calm">Calm</SelectItem>
                                <SelectItem value="enthusiastic">Enthusiastic</SelectItem>
                                <SelectItem value="serious">Serious</SelectItem>
                                <SelectItem value="gentle">Gentle</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex items-center justify-between pt-4 bg-muted/30 p-3 rounded-lg">
                        <div className="text-sm text-muted-foreground">
                            {audioUrl ? "Preview ready" : "Preview not generated"}
                        </div>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={handlePreview}
                            disabled={previewLoading}
                            className="gap-2"
                        >
                            {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                            {isPlaying ? "Stop" : "Test Voice"}
                        </Button>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={handleSave} disabled={loading} className="gap-2">
                        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                        Save Persona
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
