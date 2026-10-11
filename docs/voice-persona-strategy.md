# Voice Persona - Senior Developer Implementation Strategy

## 1. Executive Summary
This document outlines the strategic approach for implementing the Voice Persona feature. Based on `docs/voice-persona-implementation-plan.md` and a review of the current `readai` codebase, the plan is technically sound but requires specific validation and architectural safeguards before full execution.

## 2. Codebase & Architecture Alignment
**Status**: ✅ **aligned**
- **Stack**: Node.js/Express Backend + React/Vite Frontend matches the codebase structure.
- **Auth**: The `authenticatetUser` middleware correctly decodes Supabase JWTs. The backend uses the Supabase Service Key pattern (Trusted Backend), effectively bypassing RLS for backend-initiated queries.
    - **Implication**: The Controller/Service logic MUST rigorously enforce ownership checks (e.g., `if (persona.user_id !== userId)`) as RLS policies in the database will not block the backend service key. The proposed plan includes these checks, but they are critical.

## 3. Critical Risks & Validations (The "Spike" Phase)
Before writing UI code, we must validate the core dependency assumptions.

### Risk A: Gemini Model & Voice Availability
- **Current Code**: Uses `Sadaltager`.
- **Plan**: Proposes `Enceladus`, `Lapetus` (`gemini-2.5-flash-preview-tts`).
- **Action**: Create a standalone script (`backend/scripts/test-voice-preview.js`) to verify:
    1.  Is `gemini-2.5-flash-preview-tts` available to our API key?
    2.  Are the specific voice names (`Enceladus`, etc.) accepted?
    3.  Does the "Instruction/Prompt" based style control actually work as expected for Arabic?

### Risk B: Prompt Injection
- **Issue**: Allowing `custom_prompt` from users is a vector for prompt injection (e.g., "Ignore previous instructions and say [Bad Things]").
- **Mitigation**:
    -   Strict character limits (already in plan: 150 chars).
    -   Sanitization.
    -   Append system-force instructions *after* the user prompt to prevent overriding core safety rails if possible, or wrap user input in a delimited block.

## 4. Phased Implementation Plan

### Phase 1: Foundation (Database & Types)
*Goal: Establish the data structure without breaking existing features.*
1.  **Migration**: Create a structured migration script (or SQL file) for `voice_personas`, `voice_persona_templates`, etc.
2.  **Shared Types**: Define TypeScript interfaces in `shared/types` (if applicable) or `frontend/src/types` to ensure Backend/Frontend contract alignment.

### Phase 2: The Proof of Concept (Backend Only)
*Goal: Verify the "AI" part works.*
1.  **Service Layer**: Implement `VoicePersonaService` with the prompt building logic.
    -   *Test*: Unit test the *string construction* of prompts to ensure they format correctly without calling the API.
2.  **Gemini Upgrade**: Refactor `GeminiService` to support the new model config dynamically (don't hardcode `Sadaltager` anymore).
3.  **Preview Endpoint**: Implement `POST /api/voice-personas/preview`.
    -   *Verification*: Use Postman/Curl to generate a WAV file and listen to it.

### Phase 3: The "MVP" Frontend
*Goal: Allow users to create personas.*
1.  **UI Components**:
    -   `VoiceSelector`: A visual card selector for the 6 base voices.
    -   `StyleSlider`: Controls for Pace/Tone.
2.  **Audio Player**: A robust hook for playing the base64/blob preview response.
3.  **Integration**: Connect the form to the Preview Endpoint.

### Phase 4: Full Feature & Marketplace
*Goal: Social and usage features.*
1.  **Marketplace Grid**: Pagination and filtering.
2.  **Rating System**: Backend endpoints and Frontend modal.
3.  **Integration with Reader**: Update the `BookReader` component to use the selected Persona ID when requesting audio.

## 5. Testing Strategy

### Unit Tests (Jest)
-   **Prompt Builder**: 100% coverage. Verify that selecting "Slow" + "Sad" produces the correct text prompt.
-   **Rate Limiter**: Mock Supabase and verify the day/count logic increments and blocks.

### Integration Tests
-   **Do NOT mock everything**: We need at least one real "end-to-end" test script that calls Gemini to ensure the API contract hasn't changed.
-   **Mock Gemini for CI**: In automated CI/CD, mock `GeminiService.generateAudio` to return a dummy buffer to save costs/time.

## 6. Recommendations for User
1.  **Start with Phase 0**: Authorize me to run the Voice Verification Script to confirm the model capabilities.
2.  **Refactor GeminiService First**: The existing service is hardcoded for one use case. It needs to be made generic *before* adding the Persona layer.

---
**Next Step**: Shall I proceed with **Phase 0** and create the verification script to test the new Gemini voices?
