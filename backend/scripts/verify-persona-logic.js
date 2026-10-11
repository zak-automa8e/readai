// Mock env vars for config loading
process.env.GEMINI_API_KEY = 'dummy';
process.env.SUPABASE_URL = 'https://dummy.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'dummy';
process.env.SUPABASE_ANON_KEY = 'dummy';

const voicePersonaService = require('../src/services/voicePersonaService');
const config = require('../src/config/voicePersonaConfig');

async function testPromptBuilder() {
    console.log('Testing Prompt Builder...');

    const testCases = [
        {
            name: 'Default Persona',
            persona: {
                pace: 'normal',
                tone: 'neutral',
                emotion: 'calm',
                speaking_style: 'narrative'
            },
            expectedIncludes: ['natural pace', 'clear and neutral', 'calm expression']
        },
        {
            name: 'Scholar Persona',
            persona: {
                pace: 'slow',
                tone: 'professional',
                emotion: 'serious',
                speaking_style: 'educational'
            },
            expectedIncludes: ['slow, measured pace', 'professional and authoritative', 'serious demeanor', 'as an educator']
        },
        {
            name: 'Custom Prompt',
            persona: {
                custom_prompt: 'READ LIKE A PIRATE'
            },
            expectedExact: 'READ LIKE A PIRATE'
        }
    ];

    let passed = 0;
    for (const test of testCases) {
        const result = voicePersonaService.buildPrompt(test.persona);

        let success = true;
        if (test.expectedExact) {
            if (result !== test.expectedExact) success = false;
        } else {
            for (const text of test.expectedIncludes) {
                if (!result.includes(text)) {
                    success = false;
                    console.error(`  [FAIL] ${test.name}: Expected "${text}" in output`);
                }
            }
        }

        if (success) {
            console.log(`  [PASS] ${test.name}`);
            passed++;
        } else {
            console.log(`  [FAIL] ${test.name}`);
            console.log(`         Got: ${result}`);
        }
    }
    console.log(`Prompt Builder Results: ${passed}/${testCases.length} Passed\n`);
}

// Check configuration
function checkConfig() {
    console.log('Checking Configuration...');
    if (config.baseVoices.length === 6) {
        console.log('  [PASS] 6 Base Voices configured');
    } else {
        console.log(`  [FAIL] Expected 6 base voices, found ${config.baseVoices.length}`);
    }

    if (config.preview.maxPreviewsPerDay === 10) {
        console.log('  [PASS] Max previews set to 10');
    }
    console.log('');
}

async function run() {
    try {
        await testPromptBuilder();
        checkConfig();
        console.log('Verification Complete.');
    } catch (e) {
        console.error('Verification Failed:', e);
    }
}

run();
