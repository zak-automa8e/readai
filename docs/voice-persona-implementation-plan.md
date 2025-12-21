# Voice Persona Feature Implementation Plan

## Overview

This document outlines the complete implementation plan for the Voice Persona feature in ReadAI. The feature allows users to create, customize, and use personalized voice personas for text-to-speech reading of their books.

**Key Features:**
- Custom voice persona creation with style controls
- Preview audio generation before saving
- Persona marketplace where users can share and rate personas
- Usage analytics and leaderboards

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  Voice Studio   │  │  Persona        │  │  Book Reader    │  │
│  │  (Create/Edit)  │  │  Marketplace    │  │  (Use Persona)  │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
└───────────┼────────────────────┼────────────────────┼───────────┘
            │                    │                    │
            ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Backend (Node.js/Express)                   │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ Voice Persona   │  │  Gemini TTS     │  │  Rate Limiter   │  │
│  │   Controller    │  │    Service      │  │  (Preview)      │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
└───────────┼────────────────────┼────────────────────┼───────────┘
            │                    │                    │
            ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Supabase                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │ voice_personas  │  │ persona_ratings │  │  readai-media   │  │
│  │     table       │  │     table       │  │ /preview-audio/ │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Google Gemini TTS API                         │
│              gemini-2.5-flash-preview-tts model                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Google Gemini TTS Reference

### Available Base Voices (Selected for ReadAI)

| Voice Name | Recommended Use Case |
|------------|---------------------|
| Enceladus  | General reading     |
| Lapetus    | Calm narration      |
| Algieba    | Expressive reading  |
| Algenib    | Professional tone   |
| Alnilam    | Deep, authoritative |
| Schedar    | Warm, friendly      |

### Prompt Structure for Controllable TTS

The Gemini TTS API uses natural language prompts to control speech style:

```javascript
// Example prompt structure
const prompt = `Read the following text in a [PACE], [TONE] voice with [EMOTION] expression: 

[TEXT_TO_READ]`;

// Real example
const prompt = `Read the following text in a slow, warm voice with calm expression: 

بسم الله الرحمن الرحيم`;
```

### Voice Configuration Object

```javascript
const config = {
  responseModalities: ['AUDIO'],
  speechConfig: {
    voiceConfig: {
      prebuiltVoiceConfig: {
        voiceName: 'Enceladus'  // Base voice from Google
      }
    }
  }
};
```

---

## Phase 1: Database Schema

### Supabase SQL Migration

Run this SQL in Supabase SQL Editor:

```sql
-- ============================================
-- Voice Personas Table
-- ============================================
-- Stores user-created voice personas with customizable settings
-- Supports both private personas and publicly shared ones

CREATE TABLE IF NOT EXISTS voice_personas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Basic Info
    name VARCHAR(100) NOT NULL,
    description TEXT,
    
    -- Google TTS Voice Configuration
    base_voice_name VARCHAR(50) NOT NULL DEFAULT 'Enceladus',
    -- Options: Enceladus, Lapetus, Algieba, Algenib, Alnilam, Schedar
    
    -- Style Prompt Components (combined to create the system instruction)
    pace VARCHAR(20) DEFAULT 'normal',          -- slow, normal, fast
    tone VARCHAR(30) DEFAULT 'neutral',         -- warm, neutral, professional, dramatic
    emotion VARCHAR(30) DEFAULT 'calm',         -- calm, enthusiastic, serious, gentle
    speaking_style VARCHAR(50) DEFAULT 'narrative', -- narrative, conversational, educational, storytelling
    
    -- Custom prompt override (if user wants full control)
    custom_prompt TEXT,
    
    -- Visibility & Sharing
    is_public BOOLEAN DEFAULT FALSE,            -- If true, visible in marketplace
    is_featured BOOLEAN DEFAULT FALSE,          -- Admin-curated featured personas
    
    -- User Settings
    is_default BOOLEAN DEFAULT FALSE,           -- User's default persona
    is_active BOOLEAN DEFAULT TRUE,             -- Soft delete flag
    
    -- Preview Audio (saved when persona is created/updated)
    preview_audio_url TEXT,                     -- URL to stored preview audio file
    preview_text TEXT,                          -- The text used for preview
    
    -- Usage Analytics (Global - across all users who use this persona)
    total_usage_count INTEGER DEFAULT 0,        -- Total times used by all users
    total_pages_read INTEGER DEFAULT 0,         -- Total pages read with this persona
    unique_users_count INTEGER DEFAULT 0,       -- Number of unique users
    
    -- Ratings (Aggregated)
    average_rating DECIMAL(3,2) DEFAULT 0,      -- Average rating (0-5)
    total_ratings INTEGER DEFAULT 0,            -- Number of ratings received
    
    -- Metadata
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Persona Ratings Table
-- ============================================
-- Stores individual user ratings for public personas

CREATE TABLE IF NOT EXISTS persona_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_id UUID NOT NULL REFERENCES voice_personas(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review TEXT,                                -- Optional text review
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Each user can only rate a persona once
    UNIQUE(persona_id, user_id)
);

-- ============================================
-- Persona Usage Tracking Table
-- ============================================
-- Tracks which users have used which personas (for unique_users_count)

CREATE TABLE IF NOT EXISTS persona_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    persona_id UUID NOT NULL REFERENCES voice_personas(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    usage_count INTEGER DEFAULT 1,              -- How many times this user used it
    pages_read INTEGER DEFAULT 0,               -- Pages read by this user with this persona
    first_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    UNIQUE(persona_id, user_id)
);

-- ============================================
-- Preview Rate Limiting Table
-- ============================================
-- Tracks preview generations per user to prevent abuse

CREATE TABLE IF NOT EXISTS persona_preview_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    preview_count INTEGER DEFAULT 0,            -- Previews generated today
    last_preview_at TIMESTAMP WITH TIME ZONE,
    reset_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '24 hours'),
    
    UNIQUE(user_id)
);

-- ============================================
-- Indexes for Performance
-- ============================================

-- Voice Personas indexes
CREATE INDEX idx_voice_personas_user_id ON voice_personas(user_id);
CREATE INDEX idx_voice_personas_is_default ON voice_personas(user_id, is_default) WHERE is_default = TRUE;
CREATE INDEX idx_voice_personas_active ON voice_personas(user_id, is_active) WHERE is_active = TRUE;
CREATE INDEX idx_voice_personas_public ON voice_personas(is_public, is_active) WHERE is_public = TRUE AND is_active = TRUE;
CREATE INDEX idx_voice_personas_featured ON voice_personas(is_featured) WHERE is_featured = TRUE;
CREATE INDEX idx_voice_personas_popular ON voice_personas(total_usage_count DESC) WHERE is_public = TRUE;
CREATE INDEX idx_voice_personas_top_rated ON voice_personas(average_rating DESC) WHERE is_public = TRUE AND total_ratings > 0;

-- Ratings indexes
CREATE INDEX idx_persona_ratings_persona ON persona_ratings(persona_id);
CREATE INDEX idx_persona_ratings_user ON persona_ratings(user_id);

-- Usage tracking indexes
CREATE INDEX idx_persona_usage_persona ON persona_usage(persona_id);
CREATE INDEX idx_persona_usage_user ON persona_usage(user_id);

-- ============================================
-- Row Level Security (RLS)
-- ============================================

ALTER TABLE voice_personas ENABLE ROW LEVEL SECURITY;
ALTER TABLE persona_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE persona_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE persona_preview_limits ENABLE ROW LEVEL SECURITY;

-- Voice Personas Policies
-- Users can see their own personas
CREATE POLICY "Users can view own personas" ON voice_personas
    FOR SELECT USING (auth.uid() = user_id);

-- Users can see public personas from other users
CREATE POLICY "Users can view public personas" ON voice_personas
    FOR SELECT USING (is_public = TRUE AND is_active = TRUE);

-- Users can create their own personas
CREATE POLICY "Users can create own personas" ON voice_personas
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can only update their own personas
CREATE POLICY "Users can update own personas" ON voice_personas
    FOR UPDATE USING (auth.uid() = user_id);

-- Users can only delete their own personas
CREATE POLICY "Users can delete own personas" ON voice_personas
    FOR DELETE USING (auth.uid() = user_id);

-- Ratings Policies
CREATE POLICY "Users can view all ratings" ON persona_ratings
    FOR SELECT USING (TRUE);

CREATE POLICY "Users can create own ratings" ON persona_ratings
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own ratings" ON persona_ratings
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own ratings" ON persona_ratings
    FOR DELETE USING (auth.uid() = user_id);

-- Usage Policies
CREATE POLICY "Users can view own usage" ON persona_usage
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own usage" ON persona_usage
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own usage" ON persona_usage
    FOR UPDATE USING (auth.uid() = user_id);

-- Preview Limits Policies
CREATE POLICY "Users can view own limits" ON persona_preview_limits
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can create own limits" ON persona_preview_limits
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own limits" ON persona_preview_limits
    FOR UPDATE USING (auth.uid() = user_id);

-- ============================================
-- Triggers
-- ============================================

-- Update updated_at on voice_personas
CREATE OR REPLACE FUNCTION update_voice_personas_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER voice_personas_updated_at
    BEFORE UPDATE ON voice_personas
    FOR EACH ROW
    EXECUTE FUNCTION update_voice_personas_updated_at();

-- Update average_rating when new rating is added
CREATE OR REPLACE FUNCTION update_persona_rating_stats()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE voice_personas
    SET 
        average_rating = (
            SELECT COALESCE(AVG(rating), 0)
            FROM persona_ratings
            WHERE persona_id = COALESCE(NEW.persona_id, OLD.persona_id)
        ),
        total_ratings = (
            SELECT COUNT(*)
            FROM persona_ratings
            WHERE persona_id = COALESCE(NEW.persona_id, OLD.persona_id)
        )
    WHERE id = COALESCE(NEW.persona_id, OLD.persona_id);
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER persona_ratings_stats_update
    AFTER INSERT OR UPDATE OR DELETE ON persona_ratings
    FOR EACH ROW
    EXECUTE FUNCTION update_persona_rating_stats();

-- Update usage stats when persona is used
CREATE OR REPLACE FUNCTION update_persona_usage_stats()
RETURNS TRIGGER AS $$
BEGIN
    -- Update the persona's aggregate stats
    UPDATE voice_personas
    SET 
        total_usage_count = (
            SELECT COALESCE(SUM(usage_count), 0)
            FROM persona_usage
            WHERE persona_id = NEW.persona_id
        ),
        total_pages_read = (
            SELECT COALESCE(SUM(pages_read), 0)
            FROM persona_usage
            WHERE persona_id = NEW.persona_id
        ),
        unique_users_count = (
            SELECT COUNT(DISTINCT user_id)
            FROM persona_usage
            WHERE persona_id = NEW.persona_id
        ),
        last_used_at = NOW()
    WHERE id = NEW.persona_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER persona_usage_stats_update
    AFTER INSERT OR UPDATE ON persona_usage
    FOR EACH ROW
    EXECUTE FUNCTION update_persona_usage_stats();

-- ============================================
-- Default Personas (System-provided templates)
-- ============================================

CREATE TABLE IF NOT EXISTS voice_persona_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT,
    base_voice_name VARCHAR(50) NOT NULL,
    pace VARCHAR(20) DEFAULT 'normal',
    tone VARCHAR(30) DEFAULT 'neutral',
    emotion VARCHAR(30) DEFAULT 'calm',
    speaking_style VARCHAR(50) DEFAULT 'narrative',
    custom_prompt TEXT,
    icon VARCHAR(50),
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default templates
INSERT INTO voice_persona_templates (name, description, base_voice_name, pace, tone, emotion, speaking_style, icon, sort_order) VALUES
('Scholar', 'A calm, authoritative voice perfect for academic and religious texts', 'Alnilam', 'slow', 'professional', 'serious', 'educational', 'graduation-cap', 1),
('Storyteller', 'A warm, engaging voice ideal for narrative and fiction', 'Schedar', 'normal', 'warm', 'gentle', 'storytelling', 'book-open', 2),
('Companion', 'A friendly, conversational voice for casual reading', 'Algieba', 'normal', 'warm', 'calm', 'conversational', 'heart', 3),
('Narrator', 'A clear, neutral voice for general content', 'Enceladus', 'normal', 'neutral', 'calm', 'narrative', 'mic', 4),
('Night Reader', 'A soft, soothing voice perfect for bedtime reading', 'Lapetus', 'slow', 'warm', 'gentle', 'narrative', 'moon', 5);

-- ============================================
-- Update existing page_audio table (if needed)
-- ============================================

ALTER TABLE page_audio 
ADD COLUMN IF NOT EXISTS voice_persona_id UUID REFERENCES voice_personas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_page_audio_persona ON page_audio(voice_persona_id);
```

---

## Phase 2: Backend Implementation

### 2.1 Configuration Constants

**File: `backend/src/config/voicePersonaConfig.js`**

```javascript
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
  
  // Base voices from Google
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
```

### 2.2 Voice Persona Service

**File: `backend/src/services/voicePersonaService.js`**

```javascript
const supabaseService = require('./supabaseService');
const logger = require('../config/logger');
const config = require('../config/voicePersonaConfig');

class VoicePersonaService {
  
  // ==========================================
  // PROMPT BUILDING
  // ==========================================
  
  buildPrompt(persona, textToRead) {
    if (persona.custom_prompt) {
      return `${persona.custom_prompt}

${textToRead}`;
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
    
    return `Read the following text ${style}, ${pace}, with a ${tone} voice and ${emotion}:

${textToRead}`;
  }
  
  // ==========================================
  // PREVIEW RATE LIMITING
  // ==========================================
  
  async checkPreviewLimit(userId) {
    const { data, error } = await supabaseService.supabase
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
    const { data, error } = await supabaseService.supabase
      .from('persona_preview_limits')
      .upsert({
        user_id: userId,
        preview_count: 1,
        last_preview_at: new Date().toISOString(),
        reset_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      }, {
        onConflict: 'user_id',
        ignoreDuplicates: false
      })
      .select()
      .single();
    
    if (error) throw error;
    
    // Increment count if record existed
    if (data.preview_count > 1 || !data) {
      await supabaseService.supabase
        .from('persona_preview_limits')
        .update({ 
          preview_count: data.preview_count + 1,
          last_preview_at: new Date().toISOString()
        })
        .eq('user_id', userId);
    }
  }
  
  async resetPreviewLimit(userId) {
    await supabaseService.supabase
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
    const { data, error } = await supabaseService.supabase
      .from('voice_personas')
      .select('*, users:user_id(email)')
      .eq('user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
  }
  
  async getPersonaById(personaId, userId = null) {
    let query = supabaseService.supabase
      .from('voice_personas')
      .select('*, owner:user_id(id, email)')
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
  
  async getDefaultPersona(userId) {
    const { data, error } = await supabaseService.supabase
      .from('voice_personas')
      .select('*')
      .eq('user_id', userId)
      .eq('is_default', true)
      .eq('is_active', true)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  }
  
  async createPersona(userId, personaData, previewAudioUrl = null) {
    // If setting as default, unset others first
    if (personaData.is_default) {
      await this.unsetDefaultPersona(userId);
    }
    
    const { data, error } = await supabaseService.supabase
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
    
    const { data, error } = await supabaseService.supabase
      .from('voice_personas')
      .update(updateData)
      .eq('id', personaId)
      .eq('user_id', userId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
  
  async deletePersona(personaId, userId) {
    // Soft delete
    const { error } = await supabaseService.supabase
      .from('voice_personas')
      .update({ is_active: false })
      .eq('id', personaId)
      .eq('user_id', userId);
    
    if (error) throw error;
  }
  
  async unsetDefaultPersona(userId) {
    await supabaseService.supabase
      .from('voice_personas')
      .update({ is_default: false })
      .eq('user_id', userId)
      .eq('is_default', true);
  }
  
  // ==========================================
  // MARKETPLACE
  // ==========================================
  
  async getPublicPersonas(options = {}) {
    const { 
      page = 1, 
      limit = config.marketplace.pageSize,
      sortBy = 'popular', // popular, top_rated, newest
      search = null 
    } = options;
    
    let query = supabaseService.supabase
      .from('voice_personas')
      .select(`
        *,
        owner:user_id(id, email)
      `, { count: 'exact' })
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
  
  async getFeaturedPersonas() {
    const { data, error } = await supabaseService.supabase
      .from('voice_personas')
      .select('*, owner:user_id(id, email)')
      .eq('is_featured', true)
      .eq('is_public', true)
      .eq('is_active', true)
      .order('average_rating', { ascending: false })
      .limit(6);
    
    if (error) throw error;
    return data;
  }
  
  // ==========================================
  // RATINGS
  // ==========================================
  
  async ratePersona(personaId, userId, rating, review = null) {
    // Can't rate your own persona
    const persona = await this.getPersonaById(personaId);
    if (persona.user_id === userId) {
      throw new Error('Cannot rate your own persona');
    }
    
    const { data, error } = await supabaseService.supabase
      .from('persona_ratings')
      .upsert({
        persona_id: personaId,
        user_id: userId,
        rating,
        review,
        updated_at: new Date().toISOString()
      }, { onConflict: 'persona_id,user_id' })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
  
  async getPersonaRatings(personaId, page = 1, limit = 10) {
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    
    const { data, error, count } = await supabaseService.supabase
      .from('persona_ratings')
      .select('*, user:user_id(email)', { count: 'exact' })
      .eq('persona_id', personaId)
      .order('created_at', { ascending: false })
      .range(from, to);
    
    if (error) throw error;
    
    return { ratings: data, total: count };
  }
  
  // ==========================================
  // USAGE TRACKING
  // ==========================================
  
  async recordUsage(personaId, userId, pagesRead = 1) {
    // Upsert usage record
    const { data: existing } = await supabaseService.supabase
      .from('persona_usage')
      .select('*')
      .eq('persona_id', personaId)
      .eq('user_id', userId)
      .single();
    
    if (existing) {
      await supabaseService.supabase
        .from('persona_usage')
        .update({
          usage_count: existing.usage_count + 1,
          pages_read: existing.pages_read + pagesRead,
          last_used_at: new Date().toISOString()
        })
        .eq('persona_id', personaId)
        .eq('user_id', userId);
    } else {
      await supabaseService.supabase
        .from('persona_usage')
        .insert({
          persona_id: personaId,
          user_id: userId,
          usage_count: 1,
          pages_read: pagesRead
        });
    }
  }
  
  // ==========================================
  // TEMPLATES
  // ==========================================
  
  async getTemplates() {
    const { data, error } = await supabaseService.supabase
      .from('voice_persona_templates')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    
    if (error) throw error;
    return data;
  }
  
  async initializeUserPersonas(userId) {
    const templates = await this.getTemplates();
    
    for (const template of templates) {
      await this.createPersona(userId, {
        name: template.name,
        description: template.description,
        base_voice_name: template.base_voice_name,
        pace: template.pace,
        tone: template.tone,
        emotion: template.emotion,
        speaking_style: template.speaking_style,
        is_default: template.sort_order === 1
      });
    }
  }
}

module.exports = new VoicePersonaService();
```

### 2.3 Update Gemini Service

**File: `backend/src/services/geminiService.js`**

Update the `generateAudio` method:

```javascript
async generateAudio(text, voiceName = 'Enceladus', personaPrompt = null) {
  // Build the final prompt
  let finalPrompt;
  if (personaPrompt) {
    // Persona prompt already includes instructions + placeholder for text
    finalPrompt = personaPrompt.includes(text) 
      ? personaPrompt 
      : `${personaPrompt}

${text}`;
  } else {
    // Default: just read the text
    finalPrompt = `Read the following text aloud:

${text}`;
  }
  
  const truncatedPrompt = finalPrompt.length > config.maxTextLength 
    ? finalPrompt.substring(0, config.maxTextLength) + "..." 
    : finalPrompt;

  const modelConfig = {
    responseModalities: ['AUDIO'],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: voiceName,
        }
      }
    },
  };

  const model = 'gemini-2.5-flash-preview-tts';
  const contents = [
    { 
      parts: [
        { 
          text: truncatedPrompt 
        }
      ] 
    }
  ];

  logger.debug(`Calling Gemini TTS model with voice: ${voiceName}`);
  
  return this.retryWithBackoff(async () => {
    try {
      const response = await this.ai.models.generateContent({
        model,
        contents,
        config: modelConfig,
      });

      const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!audioData) {
        throw new Error('No audio data in response');
      }

      return {
        data: audioData,
        mimeType: response.candidates[0].content.parts[0].inlineData.mimeType || 'audio/wav'
      };
    } catch (error) {
      logger.error('Error in Gemini TTS processing:', error);
      throw error;
    }
  });
}
```

### 2.4 Voice Persona Controller

**File: `backend/src/controllers/voicePersonaController.js`**

```javascript
const voicePersonaService = require('../services/voicePersonaService');
const geminiService = require('../services/geminiService');
const supabaseService = require('../services/supabaseService');
const { convertToWav } = require('../utils/audioConverter');
const logger = require('../config/logger');
const config = require('../config/voicePersonaConfig');

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

// GET /api/voice-personas/featured
exports.getFeatured = async (req, res) => {
  try {
    const personas = await voicePersonaService.getFeaturedPersonas();
    res.json({ success: true, data: personas });
  } catch (error) {
    logger.error('Error fetching featured:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch featured personas' });
  }
};

// POST /api/voice-personas/preview
// Generate preview audio for persona settings (before saving)
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
      preview_text  // Optional: user-provided text (limited chars)
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
    
    // Build prompt
    const prompt = voicePersonaService.buildPrompt(tempPersona, textToSpeak);
    
    // Generate audio
    const { data: audioData, mimeType } = await geminiService.generateAudio(
      textToSpeak,
      tempPersona.base_voice_name,
      prompt
    );
    
    // Record usage
    await voicePersonaService.recordPreviewUsage(userId);
    
    res.json({ 
      success: true, 
      data: {
        audio: audioData,  // Base64 encoded
        mimeType,
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
// Create persona with the last generated preview audio
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
      preview_audio,      // Base64 audio data from preview
      preview_text
    } = req.body;
    
    let previewAudioUrl = null;
    
    // Save preview audio to readai-media bucket in preview-audio folder
    if (preview_audio) {
      const wavBuffer = convertToWav(preview_audio, 'audio/wav');
      const fileName = `persona_${Date.now()}.wav`;
      // Storage path: readai-media/preview-audio/{user_id}/{filename}
      const filePath = `preview-audio/${userId}/${fileName}`;
      previewAudioUrl = await supabaseService.saveAudioFile(wavBuffer, filePath, 'readai-media');
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
    
    // Save new preview audio to readai-media bucket in preview-audio folder
    if (preview_audio) {
      const wavBuffer = convertToWav(preview_audio, 'audio/wav');
      const fileName = `persona_${Date.now()}.wav`;
      // Storage path: readai-media/preview-audio/{user_id}/{filename}
      const filePath = `preview-audio/${userId}/${fileName}`;
      previewAudioUrl = await supabaseService.saveAudioFile(wavBuffer, filePath, 'readai-media');
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

// POST /api/voice-personas/:id/rate
exports.ratePersona = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { rating, review } = req.body;
    
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, error: 'Rating must be 1-5' });
    }
    
    const result = await voicePersonaService.ratePersona(id, userId, rating, review);
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Error rating persona:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// GET /api/voice-personas/:id/ratings
exports.getPersonaRatings = async (req, res) => {
  try {
    const { id } = req.params;
    const { page } = req.query;
    const result = await voicePersonaService.getPersonaRatings(id, parseInt(page) || 1);
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Error fetching ratings:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch ratings' });
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
```

### 2.5 Routes

**File: `backend/src/routes/voicePersonaRoutes.js`**

```javascript
const express = require('express');
const router = express.Router();
const voicePersonaController = require('../controllers/voicePersonaController');
const { authenticateToken } = require('../middleware/auth');

// Public routes (for marketplace browsing)
router.get('/config', voicePersonaController.getConfig);
router.get('/featured', voicePersonaController.getFeatured);
router.get('/marketplace', voicePersonaController.getMarketplace);
router.get('/templates', voicePersonaController.getTemplates);

// Protected routes
router.use(authenticateToken);

router.get('/', voicePersonaController.getPersonas);
router.post('/', voicePersonaController.createPersona);
router.post('/preview', voicePersonaController.generatePreview);
router.put('/:id', voicePersonaController.updatePersona);
router.delete('/:id', voicePersonaController.deletePersona);
router.post('/:id/rate', voicePersonaController.ratePersona);
router.get('/:id/ratings', voicePersonaController.getPersonaRatings);

module.exports = router;
```

---

## Phase 3: Frontend Implementation

### 3.1 API Service

**File: `frontend/src/services/voicePersonaApi.ts`**

```typescript
import api from './api';

export interface VoicePersona {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  base_voice_name: string;
  pace: 'slow' | 'normal' | 'fast';
  tone: 'warm' | 'neutral' | 'professional' | 'dramatic';
  emotion: 'calm' | 'enthusiastic' | 'serious' | 'gentle';
  speaking_style: 'narrative' | 'conversational' | 'educational' | 'storytelling';
  custom_prompt?: string;
  is_default: boolean;
  is_public: boolean;
  is_featured: boolean;
  preview_audio_url?: string;
  preview_text?: string;
  total_usage_count: number;
  total_pages_read: number;
  unique_users_count: number;
  average_rating: number;
  total_ratings: number;
  created_at: string;
  owner?: {
    id: string;
    email: string;
  };
}

export interface PreviewResponse {
  audio: string;  // Base64
  mimeType: string;
  previewText: string;
  remaining: number;
}

export interface MarketplaceResponse {
  personas: VoicePersona[];
  total: number;
  page: number;
  totalPages: number;
}

export const voicePersonaApi = {
  // Config
  getConfig: () => api.get('/voice-personas/config'),
  
  // User's personas
  getAll: () => api.get<VoicePersona[]>('/voice-personas'),
  
  // Marketplace
  getMarketplace: (page = 1, sortBy = 'popular', search?: string) => 
    api.get<MarketplaceResponse>('/voice-personas/marketplace', { 
      params: { page, sortBy, search } 
    }),
  
  getFeatured: () => api.get<VoicePersona[]>('/voice-personas/featured'),
  
  // CRUD
  create: (data: Partial<VoicePersona> & { preview_audio?: string }) => 
    api.post<VoicePersona>('/voice-personas', data),
  
  update: (id: string, data: Partial<VoicePersona> & { preview_audio?: string }) => 
    api.put<VoicePersona>(`/voice-personas/${id}`, data),
  
  delete: (id: string) => api.delete(`/voice-personas/${id}`),
  
  // Preview
  generatePreview: (settings: {
    base_voice_name: string;
    pace: string;
    tone: string;
    emotion: string;
    speaking_style: string;
    custom_prompt?: string;
    preview_text?: string;
  }) => api.post<PreviewResponse>('/voice-personas/preview', settings),
  
  // Ratings
  rate: (id: string, rating: number, review?: string) => 
    api.post(`/voice-personas/${id}/rate`, { rating, review }),
  
  getRatings: (id: string, page = 1) => 
    api.get(`/voice-personas/${id}/ratings`, { params: { page } }),
  
  // Templates
  getTemplates: () => api.get('/voice-personas/templates'),
};
```

### 3.2 Voice Studio Page Updates

Key UI components to build:

1. **Persona Builder Form**
   - Base voice dropdown (6 Google voices)
   - Pace, Tone, Emotion, Speaking Style selectors
   - Optional custom prompt textarea
   - Preview text input (limited to 150 chars) or use default
   - "Generate Preview" button with remaining count display
   - Audio player for preview
   - Save button (saves with last generated preview)

2. **Marketplace Tab**
   - Grid of public personas with owner info
   - Sort by: Popular, Top Rated, Newest
   - Search functionality
   - Rating display with stars
   - Usage stats badge (e.g., "Used 5,432 times")
   - "Use This Persona" button

3. **Rate & Review Modal**
   - Star rating (1-5)
   - Optional text review
   - Submit button

---

## Phase 4: Integration

### 4.1 Update Page Audio Generation

When generating page audio, use the persona's settings:

```javascript
async getOrGeneratePageAudio(bookId, pageNumber, text, personaId, userId) {
  // Get persona
  const persona = personaId 
    ? await voicePersonaService.getPersonaById(personaId, userId)
    : await voicePersonaService.getDefaultPersona(userId);
  
  if (!persona) {
    throw new Error('No persona selected');
  }
  
  // Build prompt
  const prompt = voicePersonaService.buildPrompt(persona, text);
  
  // Generate audio
  const { data: audioData, mimeType } = await geminiService.generateAudio(
    text,
    persona.base_voice_name,
    prompt
  );
  
  // Record usage
  await voicePersonaService.recordUsage(persona.id, userId, 1);
  
  // ... rest of caching logic with persona_id stored
}
```

---

## Execution Order

### Week 1: Database & Core Backend
1. Run Supabase migration SQL
2. Create `voicePersonaConfig.js`
3. Create `voicePersonaService.js` with rate limiting
4. Update `geminiService.js`
5. Create `voicePersonaController.js`
6. Add routes and test endpoints

### Week 2: Preview & Marketplace
1. Implement preview generation with rate limiting
2. Test preview audio quality
3. Implement marketplace queries
4. Add rating/review functionality
5. Test usage tracking triggers

### Week 3: Frontend
1. Create `voicePersonaApi.ts`
2. Build persona builder UI with preview
3. Build marketplace UI
4. Implement audio playback
5. Add rating modal

### Week 4: Integration & Polish
1. Update book reader to use personas
2. Add persona selector in reader
3. Test with Arabic text
4. Performance optimization
5. User testing

---

## Testing Checklist

### Persona Management
- [ ] Create persona with all settings
- [ ] Update persona settings
- [ ] Delete persona (soft delete)
- [ ] Set default persona
- [ ] Custom prompt works correctly

### Preview System
- [ ] Preview generates audio correctly
- [ ] Rate limiting (10/day) works
- [ ] Cooldown (30s) between previews
- [ ] Custom preview text (150 char limit)
- [ ] Default preview text rotation
- [ ] Preview audio saved on persona save

### Marketplace
- [ ] Public personas visible to all
- [ ] Private personas hidden
- [ ] Owner info displayed
- [ ] Sort by popular/rated/newest
- [ ] Search works
- [ ] Usage count updates

### Ratings
- [ ] Can rate others' personas
- [ ] Cannot rate own persona
- [ ] Average rating updates automatically
- [ ] Reviews display correctly

### Usage Tracking
- [ ] Usage count increments
- [ ] Pages read tracked
- [ ] Unique users counted
- [ ] Stats update correctly

---

## API Reference

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | /voice-personas/config | Get config options | No |
| GET | /voice-personas/featured | Get featured personas | No |
| GET | /voice-personas/marketplace | Browse public personas | No |
| GET | /voice-personas/templates | Get default templates | No |
| GET | /voice-personas | Get user's personas | Yes |
| POST | /voice-personas | Create persona | Yes |
| POST | /voice-personas/preview | Generate preview | Yes |
| PUT | /voice-personas/:id | Update persona | Yes |
| DELETE | /voice-personas/:id | Delete persona | Yes |
| POST | /voice-personas/:id/rate | Rate persona | Yes |
| GET | /voice-personas/:id/ratings | Get ratings | No |

---

## Notes

### Arabic Language Support
- Gemini TTS supports Arabic natively
- Test with various diacritics (tashkeel)
- Ensure UTF-8 encoding throughout

### Storage Structure

Preview audio files are stored in the existing `readai-media` Supabase bucket:

```
readai-media/
├── audio/              # Existing: page audio cache
├── pdfs/               # Existing: PDF files
├── thumbnails/         # Existing: book thumbnails
└── preview-audio/      # NEW: persona preview audio
    └── {user_id}/
        └── persona_{timestamp}.wav
```

### Cost Control
- Preview limit: 10/day per user
- Cooldown: 30 seconds between previews
- Max preview text: 150 characters
- Consider caching popular persona previews

### Future Enhancements
1. Voice cloning (when available)
2. Emotion detection from text
3. Multi-speaker for dialogue
4. Pronunciation dictionary
5. Persona monetization (premium personas)
