import { ContentLayout } from "@/components/layouts/ContentLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { 
  Volume2, 
  Mic2, 
  Eye, 
  Palette,
  Download,
  Upload,
  Trash2,
  Settings as SettingsIcon
} from "lucide-react";
import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { useUI, type Lang } from "@/contexts/UIContext";

const Settings = () => {
  const { theme: activeTheme, setTheme } = useTheme();
  const { lang, setLang } = useUI();

  // Mock settings state (in a real app, this would be managed by a settings context)
  const [settings, setSettings] = useState({
    // Reading preferences
    fontSize: [16],
    fontFamily: "system",
    lineHeight: [1.6],
    pageWidth: [800],
    
    // TTS settings
    voiceSpeed: [1.0],
    voicePitch: [1.0],
    selectedVoice: "default",
    autoplay: false,
    
    // AI settings
    aiResponseLength: "medium",
    aiPersonality: "helpful",
    autoSummarize: true,
    
    // App preferences
    theme: activeTheme || "system",
    language: "en",
    notifications: true,
    autoSave: true,
  });

  useEffect(() => {
    if (activeTheme) {
      setSettings(prev => ({ ...prev, theme: activeTheme }));
    }
  }, [activeTheme]);

  const updateSetting = (key: string, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    if (key === 'theme') {
      setTheme(value);
    }
  };

  return (
    <ContentLayout
      title="Settings"
      description="Customize your ReadAI experience"
    >
      <div className="space-y-8 max-w-4xl">
        {/* Reading Preferences */}
        <section>
          <div className="flex items-center gap-2 mb-6">
            <Eye className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold text-foreground">Reading Preferences</h2>
          </div>
          
          <Card className="shadow-none p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <Label htmlFor="fontSize">Font Size: {settings.fontSize[0]}px</Label>
                <Slider
                  id="fontSize"
                  min={12}
                  max={24}
                  step={1}
                  value={settings.fontSize}
                  onValueChange={(value) => updateSetting('fontSize', value)}
                  className="w-full"
                />
              </div>

              <div className="space-y-3">
                <Label htmlFor="fontFamily">Font Family</Label>
                <Select 
                  value={settings.fontFamily} 
                  onValueChange={(value) => updateSetting('fontFamily', value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">System Default</SelectItem>
                    <SelectItem value="serif">Serif (Times)</SelectItem>
                    <SelectItem value="sans">Sans-serif (Arial)</SelectItem>
                    <SelectItem value="mono">Monospace</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <Label htmlFor="lineHeight">Line Height: {settings.lineHeight[0]}</Label>
                <Slider
                  id="lineHeight"
                  min={1.2}
                  max={2.0}
                  step={0.1}
                  value={settings.lineHeight}
                  onValueChange={(value) => updateSetting('lineHeight', value)}
                  className="w-full"
                />
              </div>

              <div className="space-y-3">
                <Label htmlFor="pageWidth">Page Width: {settings.pageWidth[0]}px</Label>
                <Slider
                  id="pageWidth"
                  min={600}
                  max={1200}
                  step={50}
                  value={settings.pageWidth}
                  onValueChange={(value) => updateSetting('pageWidth', value)}
                  className="w-full"
                />
              </div>
            </div>
          </Card>
        </section>

        {/* TTS Settings */}
        <section>
          <div className="flex items-center gap-2 mb-6">
            <Volume2 className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold text-foreground">Text-to-Speech</h2>
          </div>
          
          <Card className="shadow-none p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <Label htmlFor="voiceSpeed">Speech Speed: {settings.voiceSpeed[0]}x</Label>
                <Slider
                  id="voiceSpeed"
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  value={settings.voiceSpeed}
                  onValueChange={(value) => updateSetting('voiceSpeed', value)}
                  className="w-full"
                />
              </div>

              <div className="space-y-3">
                <Label htmlFor="voicePitch">Voice Pitch: {settings.voicePitch[0]}</Label>
                <Slider
                  id="voicePitch"
                  min={0.5}
                  max={1.5}
                  step={0.1}
                  value={settings.voicePitch}
                  onValueChange={(value) => updateSetting('voicePitch', value)}
                  className="w-full"
                />
              </div>

              <div className="space-y-3">
                <Label htmlFor="selectedVoice">Voice Selection</Label>
                <Select 
                  value={settings.selectedVoice} 
                  onValueChange={(value) => updateSetting('selectedVoice', value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default Voice</SelectItem>
                    <SelectItem value="male1">Male Voice 1</SelectItem>
                    <SelectItem value="female1">Female Voice 1</SelectItem>
                    <SelectItem value="neutral">Neutral Voice</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="autoplay">Auto-play on page turn</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically start reading new pages
                  </p>
                </div>
                <Switch
                  id="autoplay"
                  checked={settings.autoplay}
                  onCheckedChange={(checked) => updateSetting('autoplay', checked)}
                />
              </div>
            </div>

            <Separator />

            <div className="flex flex-wrap gap-3">
              <Button variant="outline" size="sm" className="gap-2">
                <Mic2 className="h-4 w-4" />
                Test Voice
              </Button>
              <Button variant="outline" size="sm">
                Voice Samples
              </Button>
            </div>
          </Card>
        </section>

        {/* AI Assistant */}
        <section>
          <div className="flex items-center gap-2 mb-6">
            <SettingsIcon className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold text-foreground">AI Assistant</h2>
          </div>
          
          <Card className="shadow-none p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <Label htmlFor="aiResponseLength">Response Length</Label>
                <Select 
                  value={settings.aiResponseLength} 
                  onValueChange={(value) => updateSetting('aiResponseLength', value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="brief">Brief</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="detailed">Detailed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <Label htmlFor="aiPersonality">AI Personality</Label>
                <Select 
                  value={settings.aiPersonality} 
                  onValueChange={(value) => updateSetting('aiPersonality', value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="helpful">Helpful</SelectItem>
                    <SelectItem value="scholarly">Scholarly</SelectItem>
                    <SelectItem value="casual">Casual</SelectItem>
                    <SelectItem value="professional">Professional</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="autoSummarize">Auto-summarize chapters</Label>
                <p className="text-sm text-muted-foreground">
                  Generate summaries when finishing chapters
                </p>
              </div>
              <Switch
                id="autoSummarize"
                checked={settings.autoSummarize}
                onCheckedChange={(checked) => updateSetting('autoSummarize', checked)}
              />
            </div>
          </Card>
        </section>

        {/* App Preferences */}
        <section>
          <div className="flex items-center gap-2 mb-6">
            <Palette className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold text-foreground">App Preferences</h2>
          </div>
          
          <Card className="shadow-none p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <Label htmlFor="theme">Theme</Label>
                <Select 
                  value={settings.theme} 
                  onValueChange={(value) => updateSetting('theme', value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">System</SelectItem>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <Label htmlFor="language">Language</Label>
                <Select 
                  value={settings.language} 
                  onValueChange={(value) => updateSetting('language', value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="es">Español</SelectItem>
                    <SelectItem value="fr">Français</SelectItem>
                    <SelectItem value="de">Deutsch</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <Label htmlFor="interface-language">Interface language</Label>
                <Select
                  value={lang}
                  onValueChange={(value) => setLang(value as Lang)}
                >
                  <SelectTrigger id="interface-language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="ar">العربية</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="notifications">Notifications</Label>
                  <p className="text-sm text-muted-foreground">
                    Receive reading reminders and updates
                  </p>
                </div>
                <Switch
                  id="notifications"
                  checked={settings.notifications}
                  onCheckedChange={(checked) => updateSetting('notifications', checked)}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="autoSave">Auto-save progress</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically save reading position
                  </p>
                </div>
                <Switch
                  id="autoSave"
                  checked={settings.autoSave}
                  onCheckedChange={(checked) => updateSetting('autoSave', checked)}
                />
              </div>
            </div>
          </Card>
        </section>

        {/* Data Management */}
        <section>
          <div className="flex items-center gap-2 mb-6">
            <Download className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold text-foreground">Data Management</h2>
          </div>
          
          <Card className="shadow-none p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Button variant="outline" className="gap-2">
                <Download className="h-4 w-4" />
                Export Data
              </Button>
              <Button variant="outline" className="gap-2">
                <Upload className="h-4 w-4" />
                Import Data
              </Button>
              <Button variant="outline" className="gap-2">
                <Download className="h-4 w-4" />
                Backup Settings
              </Button>
              <Button variant="outline" className="gap-2 text-destructive hover:text-destructive">
                <Trash2 className="h-4 w-4" />
                Clear All Data
              </Button>
            </div>
          </Card>
        </section>

        {/* Save Button */}
        <div className="flex justify-end gap-4">
          <Button variant="outline">Reset to Defaults</Button>
          <Button>Save Settings</Button>
        </div>
      </div>
    </ContentLayout>
  );
};

export default Settings;
