const voicePersonaService = require('../services/voicePersonaService');
const llm = require('../services/llm');
const { pcmToWav } = require('../services/llm/audio');
const { truncateForLegacyAudio } = require('../utils/audioUtils');
const supabaseService = require('../services/supabaseService');
const logger = require('../utils/logger');
const config = require('../config/voicePersonaConfig');

// Helper to convert base64/buffer to wav not deeply implemented here 
// since we will likely receive base64 from frontend or handle it differently. 
// For now, let's assume we receive base64 data for the preview audio save.
const { Buffer } = require('buffer');

// GET /api/voice-personas
exports.getPersonas = async (req, res) => {
    try {
        const userId = req.user.id;
        const personas = await voicePersonaService.getUserPersonas(userId);
        res.json({ success: true, data: personas });
    } catch (error) {
        logger.error('Error fetching personas:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch personas' });
    }
};

// GET /api/voice-personas/marketplace
exports.getMarketplace = async (req, res) => {
    try {
        const { page, sortBy, search } = req.query;
        const result = await voicePersonaService.getPublicPersonas({
            page: parseInt(page) || 1,
            sortBy: sortBy || 'popular',
            search
        });
        res.json({ success: true, data: result });
    } catch (error) {
        logger.error('Error fetching marketplace:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch marketplace' });
    }
};

// GET /api/voice-personas/templates
exports.getTemplates = async (req, res) => {
    try {
        const templates = await voicePersonaService.getTemplates();
        res.json({ success: true, data: templates });
    } catch (error) {
        logger.error('Error fetching templates:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch templates' });
    }
};

// POST /api/voice-personas/preview
exports.generatePreview = async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            base_voice_name,
            pace,
            tone,
            emotion,
            speaking_style,
            custom_prompt,
            preview_text
        } = req.body;

        // Check rate limit
        const limitCheck = await voicePersonaService.checkPreviewLimit(userId);
        if (!limitCheck.canPreview) {
            return res.status(429).json({
                success: false,
                error: 'Preview limit reached',
                remaining: limitCheck.remaining,
                waitSeconds: limitCheck.waitSeconds,
                resetAt: limitCheck.resetAt
            });
        }

        // Validate preview text length
        let textToSpeak = preview_text;
        if (textToSpeak && textToSpeak.length > config.preview.maxPreviewTextLength) {
            textToSpeak = textToSpeak.substring(0, config.preview.maxPreviewTextLength);
        }
        if (!textToSpeak) {
            textToSpeak = voicePersonaService.getRandomPreviewText();
        }

        // Build temp persona object
        const tempPersona = {
            base_voice_name: base_voice_name || 'Enceladus',
            pace: pace || 'normal',
            tone: tone || 'neutral',
            emotion: emotion || 'calm',
            speaking_style: speaking_style || 'narrative',
            custom_prompt
        };

        // Build system instruction prompt (style control)
        const systemInstruction = voicePersonaService.buildPrompt(tempPersona);

        // Generate audio
        const audio = await llm.synthesize({
            text: truncateForLegacyAudio(textToSpeak),
            baseVoice: tempPersona.base_voice_name,
            styleInstruction: systemInstruction
        });

        logger.info(`Preview generation - ${audio.usage.provider} response: sampleRate=${audio.sampleRate}, pcmBytes=${audio.pcm.length}`);

        // The layer returns raw PCM, so the preview always needs a WAV header
        const wavBase64 = pcmToWav(audio).toString('base64');

        // Record usage
        await voicePersonaService.recordPreviewUsage(userId);

        res.json({
            success: true,
            data: {
                audio: wavBase64,
                mimeType: 'audio/wav',
                previewText: textToSpeak,
                remaining: limitCheck.remaining - 1
            }
        });
    } catch (error) {
        logger.error('Error generating preview:', error);
        res.status(500).json({ success: false, error: 'Failed to generate preview' });
    }
};

// POST /api/voice-personas
exports.createPersona = async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            name,
            description,
            base_voice_name,
            pace,
            tone,
            emotion,
            speaking_style,
            custom_prompt,
            is_default,
            is_public,
            preview_audio,      // Base64 audio data
            preview_text
        } = req.body;

        let previewAudioUrl = null;

        // Save preview audio if provided
        if (preview_audio) {
            // Assuming preview_audio is base64 string
            const buffer = Buffer.from(preview_audio, 'base64');
            const fileName = `persona_${Date.now()}.wav`; // Assuming Wav from Gemini
            const filePath = `preview-audio/${userId}/${fileName}`;
            previewAudioUrl = await supabaseService.saveAudioFile(buffer, filePath);
        }

        const persona = await voicePersonaService.createPersona(userId, {
            name,
            description,
            base_voice_name,
            pace,
            tone,
            emotion,
            speaking_style,
            custom_prompt,
            is_default,
            is_public,
            preview_text
        }, previewAudioUrl);

        res.status(201).json({ success: true, data: persona });
    } catch (error) {
        logger.error('Error creating persona:', error);
        res.status(500).json({ success: false, error: 'Failed to create persona' });
    }
};

// PUT /api/voice-personas/:id
exports.updatePersona = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const { preview_audio, ...updates } = req.body;

        let previewAudioUrl = null;

        if (preview_audio) {
            const buffer = Buffer.from(preview_audio, 'base64');
            const fileName = `persona_${Date.now()}.wav`;
            const filePath = `preview-audio/${userId}/${fileName}`;
            previewAudioUrl = await supabaseService.saveAudioFile(buffer, filePath);
        }

        const persona = await voicePersonaService.updatePersona(id, userId, updates, previewAudioUrl);
        res.json({ success: true, data: persona });
    } catch (error) {
        logger.error('Error updating persona:', error);
        res.status(500).json({ success: false, error: 'Failed to update persona' });
    }
};

// DELETE /api/voice-personas/:id
exports.deletePersona = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        await voicePersonaService.deletePersona(id, userId);
        res.json({ success: true, message: 'Persona deleted' });
    } catch (error) {
        logger.error('Error deleting persona:', error);
        res.status(500).json({ success: false, error: 'Failed to delete persona' });
    }
};

// GET /api/voice-personas/config
exports.getConfig = async (req, res) => {
    res.json({
        success: true,
        data: {
            baseVoices: config.baseVoices,
            paceOptions: config.paceOptions,
            toneOptions: config.toneOptions,
            emotionOptions: config.emotionOptions,
            speakingStyleOptions: config.speakingStyleOptions,
            maxPreviewTextLength: config.preview.maxPreviewTextLength,
            maxPreviewsPerDay: config.preview.maxPreviewsPerDay
        }
    });
};
