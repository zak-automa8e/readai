export interface VoicePersona {
    id: string;
    user_id: string;
    name: string;
    description?: string;
    base_voice_name: string;
    pace: 'slow' | 'normal' | 'fast';
    tone: 'warm' | 'neutral' | 'professional' | 'dramatic';
    emotion: 'calm' | 'enthusiastic' | 'serious' | 'gentle';
    speaking_style?: string;
    custom_prompt?: string;
    is_public: boolean;
    is_featured: boolean;
    is_default: boolean;
    is_active: boolean;
    preview_audio_url?: string;
    preview_text?: string;

    // Stats
    total_usage_count: number;
    total_pages_read: number;
    unique_users_count: number;
    average_rating: number;
    total_ratings: number;

    created_at: string;
    updated_at: string;

    // Virtual
    owner?: {
        id: string;
        email: string;
    };
}

export interface CreatePersonaRequest {
    name: string;
    description?: string;
    base_voice_name: string;
    pace?: string;
    tone?: string;
    emotion?: string;
    speaking_style?: string;
    custom_prompt?: string;
    is_public?: boolean;
    preview_audio_url?: string;
    preview_audio?: string; // Base64 encoded audio
    preview_text?: string;
}

export interface UpdatePersonaRequest extends Partial<CreatePersonaRequest> {
    is_default?: boolean;
    is_active?: boolean;
}

export interface VoicePersonaConfigResponse {
    preview: {
        maxPreviewsPerDay: number;
        // ...
    };
    baseVoices: Array<{
        id: string;
        name: string;
        description: string;
    }>;
}

export interface MarketplaceResponse {
    personas: VoicePersona[];
    total: number;
    page: number;
    totalPages: number;
}
