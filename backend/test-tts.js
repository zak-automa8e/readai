const express = require('express');
const { GoogleGenAI } = require('@google/genai');

// Test script to verify text-to-audio functionality
async function testTextToAudio() {
  // Check if API key is set
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY environment variable not set.");
    console.log("Please set your Gemini API key in the environment variables.");
    return;
  }

  const ai = new GoogleGenAI({
    apiKey: GEMINI_API_KEY,
  });

  const config = {
    temperature: 1,
    responseModalities: ['audio'],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: 'Zephyr',
        }
      }
    },
  };

  const model = 'gemini-2.5-pro-preview-tts';
  const contents = [
    {
      role: 'user',
      parts: [
        {
          text: 'Hello, this is a test of the text-to-speech functionality.',
        },
      ],
    },
  ];

  try {
    console.log("Testing text-to-audio functionality...");
    
    const response = await ai.models.generateContentStream({
      model,
      config,
      contents,
    });

    let hasAudioData = false;
    let audioBuffers = [];
    
    for await (const chunk of response) {
      if (!chunk.candidates || !chunk.candidates[0].content || !chunk.candidates[0].content.parts) {
        continue;
      }
      
      if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
        const inlineData = chunk.candidates[0].content.parts[0].inlineData;
        const audioBuffer = Buffer.from(inlineData.data || '', 'base64');
        audioBuffers.push(audioBuffer);
        hasAudioData = true;
        console.log(`Received audio chunk of ${audioBuffer.length} bytes`);
      }
    }

    if (hasAudioData) {
      const totalSize = audioBuffers.reduce((sum, buffer) => sum + buffer.length, 0);
      console.log(`✅ Success! Generated ${audioBuffers.length} audio chunks totaling ${totalSize} bytes`);
    } else {
      console.log("❌ No audio data generated");
    }

  } catch (error) {
    console.error("❌ Error testing text-to-audio:", error.message);
    if (error.message.includes('not found')) {
      console.log("Note: The gemini-2.5-pro-preview-tts model may not be available in your region or API access level.");
    }
  }
}

// Run the test
testTextToAudio();
