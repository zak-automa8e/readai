const supabaseService = require('../src/services/supabaseService');
const voicePersonaService = require('../src/services/voicePersonaService');

jest.mock('../src/services/supabaseService', () => ({
    adminClient: { from: jest.fn() }
}));
jest.mock('../src/utils/logger');

describe('VoicePersonaService.getAccessiblePersona', () => {
    const ownerId = 'user-owner';
    const otherUserId = 'user-other';
    const personaId = '3f2b8c1e-0d4a-4b7e-9c11-aaaaaaaaaaaa';
    let query;

    const mockRow = (row, error = null) => {
        query = {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: row, error })
        };
        supabaseService.adminClient.from.mockReturnValue(query);
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns the owner their own private persona', async () => {
        const row = { id: personaId, user_id: ownerId, is_public: false };
        mockRow(row);

        await expect(voicePersonaService.getAccessiblePersona(personaId, ownerId)).resolves.toBe(row);
        expect(query.eq).toHaveBeenCalledWith('id', personaId);
        expect(query.eq).toHaveBeenCalledWith('is_active', true);
    });

    it('does not return another user\'s private persona', async () => {
        mockRow({ id: personaId, user_id: ownerId, is_public: false });

        await expect(voicePersonaService.getAccessiblePersona(personaId, otherUserId)).resolves.toBeNull();
    });

    it('returns a public template to any user', async () => {
        const row = { id: personaId, user_id: ownerId, is_public: true };
        mockRow(row);

        await expect(voicePersonaService.getAccessiblePersona(personaId, otherUserId)).resolves.toBe(row);
    });

    it('returns null when the persona does not exist', async () => {
        mockRow(null);

        await expect(voicePersonaService.getAccessiblePersona(personaId, ownerId)).resolves.toBeNull();
    });

    it('returns null for a malformed id without querying', async () => {
        await expect(voicePersonaService.getAccessiblePersona('Sadaltager', ownerId)).resolves.toBeNull();
        expect(supabaseService.adminClient.from).not.toHaveBeenCalled();
    });

    it('propagates database errors', async () => {
        mockRow(null, new Error('db down'));

        await expect(voicePersonaService.getAccessiblePersona(personaId, ownerId)).rejects.toThrow('db down');
    });
});
