import {
    VoicePersona,
    VoicePersonaConfigResponse,
    CreatePersonaRequest,
    UpdatePersonaRequest,
    MarketplaceResponse
} from '@/types/voicePersona';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const getAuthHeaders = () => {
    const session = localStorage.getItem('readai_session');
    if (session) {
        try {
            const parsedSession = JSON.parse(session);
            if (parsedSession.access_token) {
                return {
                    'Authorization': `Bearer ${parsedSession.access_token}`
                };
            }
        } catch (error) {
            console.error('Error parsing session', error);
        }
    }
    return {};
};

// Define types locally if not yet present in @/types (Senior dev would usually extract these)
// VoicePersonaDTO removed in favor of shared VoicePersona type to avoid sync issues

export const voicePersonaService = {

    async getConfig() {
        const response = await fetch(`${API_BASE_URL}/voice-personas/config`, {
            headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) throw new Error('Failed to fetch config');
        return (await response.json()).data;
    },

    async getMyPersonas(): Promise<VoicePersona[]> {
        const response = await fetch(`${API_BASE_URL}/voice-personas`, {
            headers: {
                'Accept': 'application/json',
                ...getAuthHeaders()
            }
        });
        if (!response.ok) throw new Error('Failed to fetch personas');
        return (await response.json()).data;
    },

    async getMarketplace(params?: { page?: number, sort?: string }): Promise<MarketplaceResponse> {
        const searchParams = new URLSearchParams();
        if (params?.page) searchParams.append('page', params.page.toString());
        if (params?.sort) searchParams.append('sort', params.sort);

        const response = await fetch(`${API_BASE_URL}/voice-personas/marketplace?${searchParams}`, {
            headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) throw new Error('Failed to fetch marketplace');
        return (await response.json()).data;
    },

    async createPersona(data: Partial<VoicePersona>) {
        const response = await fetch(`${API_BASE_URL}/voice-personas`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error('Failed to create persona');
        return response.json();
    },

    async updatePersona(id: string, data: Partial<VoicePersona>) {
        const response = await fetch(`${API_BASE_URL}/voice-personas/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error('Failed to update persona');
        return response.json();
    },

    async deletePersona(id: string) {
        const response = await fetch(`${API_BASE_URL}/voice-personas/${id}`, {
            method: 'DELETE',
            headers: { ...getAuthHeaders() }
        });
        if (!response.ok) throw new Error('Failed to delete persona');
        return response.json();
    },

    async previewVoice(data: { base_voice_name: string; pace: string; tone: string; emotion: string; text?: string }): Promise<Blob> {
        const response = await fetch(`${API_BASE_URL}/voice-personas/preview`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify(data)
        });

        if (response.status === 429) throw new Error('Rate limit exceeded');
        if (!response.ok) throw new Error('Failed to generate preview');

        const result = await response.json();
        // Backend returns: { success: true, data: { audio: "base64...", mimeType: "..." } }

        if (!result.data || !result.data.audio) {
            throw new Error('No audio data received');
        }

        // Convert base64 to Blob
        try {
            const byteCharacters = atob(result.data.audio);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            return new Blob([byteArray], { type: result.data.mimeType || 'audio/wav' });
        } catch (e) {
            console.error('Error decoding audio data', e);
            throw new Error('Failed to decode audio data');
        }
    }
};
