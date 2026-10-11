module.exports = {
    // Preview limits
    preview: {
        maxPreviewsPerDay: 10,           // Max previews per user per day
        maxPreviewTextLength: 150,       // Max characters for custom preview text
        defaultPreviewTexts: [
            // Arabic preview texts for book reading context
            'بسم الله الرحمن الرحيم. الحمد لله رب العالمين.',
            'في هذا الكتاب، سنستكشف معاً أفكاراً جديدة ورؤى ملهمة.',
            'القراءة نور، والجهل ظلام. فلنقرأ ونتعلم معاً.',
        ],
        cooldownSeconds: 30,              // Minimum seconds between previews
    },

    // Marketplace settings
    marketplace: {
        minRatingsForFeatured: 10,        // Min ratings to be featured
        minRatingForFeatured: 4.0,        // Min average rating to be featured
        pageSize: 20,                     // Personas per page in marketplace
    },

    // Base voices from Google Gemini
    baseVoices: [
        { id: 'Enceladus', name: 'Enceladus', description: 'General reading' },
        { id: 'Lapetus', name: 'Lapetus', description: 'Calm narration' },
        { id: 'Algieba', name: 'Algieba', description: 'Expressive reading' },
        { id: 'Algenib', name: 'Algenib', description: 'Professional tone' },
        { id: 'Alnilam', name: 'Alnilam', description: 'Deep, authoritative' },
        { id: 'Schedar', name: 'Schedar', description: 'Warm, friendly' },
    ],

    // Style options
    paceOptions: ['slow', 'normal', 'fast'],
    toneOptions: ['warm', 'neutral', 'professional', 'dramatic'],
    emotionOptions: ['calm', 'enthusiastic', 'serious', 'gentle'],
    speakingStyleOptions: ['narrative', 'conversational', 'educational', 'storytelling'],
};
