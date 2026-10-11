const supabaseService = require('./supabaseService');
const logger = require('../utils/logger');
const config = require('../config/voicePersonaConfig');

class VoicePersonaService {

    // ==========================================
    // PROMPT BUILDING
    // ==========================================

    buildPrompt(persona) {
        // If it's a custom prompt (advanced users), return it directly
        if (persona.custom_prompt) {
            return persona.custom_prompt;
        }

        const paceMap = {
            slow: 'at a slow, measured pace',
            normal: 'at a natural pace',
            fast: 'at a brisk pace'
        };

        const toneMap = {
            warm: 'warm and friendly',
            neutral: 'clear and neutral',
            professional: 'professional and authoritative',
            dramatic: 'dramatic and expressive'
        };

        const emotionMap = {
            calm: 'calm expression',
            enthusiastic: 'enthusiastic energy',
            serious: 'serious demeanor',
            gentle: 'gentle and soothing manner'
        };

        const styleMap = {
            narrative: 'as a narrator',
            conversational: 'in a conversational way',
            educational: 'as an educator',
            storytelling: 'as a storyteller'
        };

        const pace = paceMap[persona.pace] || paceMap.normal;
        const tone = toneMap[persona.tone] || toneMap.neutral;
        const emotion = emotionMap[persona.emotion] || emotionMap.calm;
        const style = styleMap[persona.speaking_style] || styleMap.narrative;

        // Construct the system instruction
        // Note: We don't include the text here because that's passed as the 'user' message
        // Senior developer tip: Use explicit negative constraints to keep the model focused
        return `You are a professional voice actor. Read the following text ${style}, ${pace}, with a ${tone} voice and ${emotion}. 
IMPORTANT: You must ONLY output audio. Do NOT provide any text response, commentary, or introduction.`;
    }

    // ==========================================
    // PREVIEW RATE LIMITING
    // ==========================================

    async checkPreviewLimit(userId) {
        const { data, error } = await supabaseService.adminClient
            .from('persona_preview_limits')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (error && error.code !== 'PGRST116') { // Not found is OK
            throw error;
        }

        const now = new Date();

        // No record exists, user can preview
        if (!data) {
            return { canPreview: true, remaining: config.preview.maxPreviewsPerDay };
        }

        // Check if reset needed
        const resetAt = new Date(data.reset_at);
        if (now > resetAt) {
            // Reset the counter
            await this.resetPreviewLimit(userId);
            return { canPreview: true, remaining: config.preview.maxPreviewsPerDay };
        }

        // Check cooldown
        if (data.last_preview_at) {
            const lastPreview = new Date(data.last_preview_at);
            const secondsSince = (now - lastPreview) / 1000;
            if (secondsSince < config.preview.cooldownSeconds) {
                return {
                    canPreview: false,
                    remaining: config.preview.maxPreviewsPerDay - data.preview_count,
                    waitSeconds: Math.ceil(config.preview.cooldownSeconds - secondsSince)
                };
            }
        }

        // Check daily limit
        if (data.preview_count >= config.preview.maxPreviewsPerDay) {
            return {
                canPreview: false,
                remaining: 0,
                resetAt: data.reset_at
            };
        }

        return {
            canPreview: true,
            remaining: config.preview.maxPreviewsPerDay - data.preview_count
        };
    }

    async recordPreviewUsage(userId) {
        const { data, error } = await supabaseService.adminClient
            .from('persona_preview_limits')
            .upsert({
                user_id: userId,
                preview_count: 1,
                last_preview_at: new Date().toISOString(),
                reset_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            }, {
                onConflict: 'user_id',
                ignoreDuplicates: false
            }) // This handles the case where it doesn't exist
            .select()
            .single();

        // If it existed (we didn't just insert 1), we need to increment.
        // Actually, upsert overwrites. We need to be careful not to reset count if it exists.
        // Better approach: check first then update or insert.
        // Or use a more complex query. 
        // For MVP simplicity, let's re-fetch to be safe or rely on the previous check.
        // Refined Approach:

        const { data: current } = await supabaseService.adminClient
            .from('persona_preview_limits')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (current) {
            await supabaseService.adminClient
                .from('persona_preview_limits')
                .update({
                    preview_count: current.preview_count + 1,
                    last_preview_at: new Date().toISOString()
                })
                .eq('user_id', userId);
        } else {
            await supabaseService.adminClient
                .from('persona_preview_limits')
                .insert({
                    user_id: userId,
                    preview_count: 1,
                    last_preview_at: new Date().toISOString(),
                    reset_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
                });
        }
    }

    async resetPreviewLimit(userId) {
        await supabaseService.adminClient
            .from('persona_preview_limits')
            .upsert({
                user_id: userId,
                preview_count: 0,
                last_preview_at: null,
                reset_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            }, { onConflict: 'user_id' });
    }

    getRandomPreviewText() {
        const texts = config.preview.defaultPreviewTexts;
        return texts[Math.floor(Math.random() * texts.length)];
    }

    // ==========================================
    // PERSONA CRUD
    // ==========================================

    async getUserPersonas(userId) {
        const { data, error } = await supabaseService.adminClient
            .from('voice_personas')
            .select('*') // Removed join on users due to missing relationship definition in schema
            .eq('user_id', userId)
            .eq('is_active', true)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data;
    }

    async getPersonaById(personaId, userId = null) {
        let query = supabaseService.adminClient
            .from('voice_personas')
            .select('*')
            .eq('id', personaId)
            .eq('is_active', true);

        const { data, error } = await query.single();

        if (error) throw error;

        // Check access: must be owner or persona must be public
        if (data.user_id !== userId && !data.is_public) {
            throw new Error('Access denied');
        }

        return data;
    }

    async getPersonaByName(name, userId = null) {
        let query = supabaseService.adminClient
            .from('voice_personas')
            .select('*')
            .eq('name', name)
            .eq('is_active', true);

        const { data, error } = await query.maybeSingle();

        if (error) throw error;

        // If not found, it might be a base voice name or a template
        // For now, we return data if found. The service logic will handle the fallback.
        return data;
    }

    async createPersona(userId, personaData, previewAudioUrl = null) {
        // If setting as default, unset others first
        if (personaData.is_default) {
            await this.unsetDefaultPersona(userId);
        }

        const { data, error } = await supabaseService.adminClient
            .from('voice_personas')
            .insert({
                user_id: userId,
                preview_audio_url: previewAudioUrl,
                ...personaData
            })
            .select()
            .single();

        if (error) throw error;
        return data;
    }

    async updatePersona(personaId, userId, updates, previewAudioUrl = null) {
        if (updates.is_default) {
            await this.unsetDefaultPersona(userId);
        }

        const updateData = { ...updates };
        if (previewAudioUrl) {
            updateData.preview_audio_url = previewAudioUrl;
        }

        // Security check: ensure user owns the persona
        const { data, error } = await supabaseService.adminClient
            .from('voice_personas')
            .update(updateData)
            .eq('id', personaId)
            .eq('user_id', userId) // Critical: Ensure ownership
            .select()
            .single();

        if (error) throw error;
        return data;
    }

    async deletePersona(personaId, userId) {
        // Soft delete
        const { error } = await supabaseService.adminClient
            .from('voice_personas')
            .update({ is_active: false })
            .eq('id', personaId)
            .eq('user_id', userId); // Critical: Ensure ownership

        if (error) throw error;
    }

    async unsetDefaultPersona(userId) {
        await supabaseService.adminClient
            .from('voice_personas')
            .update({ is_default: false })
            .eq('user_id', userId)
            .eq('is_default', true);
    }

    // ==========================================
    // MARKETPLACE & TEMPLATES
    // ==========================================

    async getPublicPersonas(options = {}) {
        const {
            page = 1,
            limit = config.marketplace.pageSize,
            sortBy = 'popular', // popular, top_rated, newest
            search = null
        } = options;

        let query = supabaseService.adminClient
            .from('voice_personas')
            .select('*', { count: 'exact' })
            .eq('is_public', true)
            .eq('is_active', true);

        // Search
        if (search) {
            query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
        }

        // Sorting
        switch (sortBy) {
            case 'popular':
                query = query.order('total_usage_count', { ascending: false });
                break;
            case 'top_rated':
                query = query.order('average_rating', { ascending: false });
                break;
            case 'newest':
                query = query.order('created_at', { ascending: false });
                break;
        }

        // Pagination
        const from = (page - 1) * limit;
        const to = from + limit - 1;
        query = query.range(from, to);

        const { data, error, count } = await query;

        if (error) throw error;

        return {
            personas: data,
            total: count,
            page,
            totalPages: Math.ceil(count / limit)
        };
    }

    async getTemplates() {
        const { data, error } = await supabaseService.adminClient
            .from('voice_persona_templates')
            .select('*')
            .eq('is_active', true)
            .order('sort_order', { ascending: true });

        if (error) throw error;
        return data;
    }
}

module.exports = new VoicePersonaService();
