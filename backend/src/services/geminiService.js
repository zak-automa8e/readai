const { GoogleGenAI } = require('@google/genai');
const config = require('../config');
const logger = require('../utils/logger');

class GeminiService {
  constructor() {
    this.ai = new GoogleGenAI({
      apiKey: config.geminiApiKey,
    });

    logger.info('Gemini AI service initialized');
  }

  /**
   * Process an image and extract text content
   * @param {string} imageData - Base64 encoded image data
   * @param {string} mimeType - MIME type of the image
   * @returns {Promise<Object>} - Extracted text in JSON format
   */
  async processImageToText(imageData, mimeType) {
    // Validate input parameters
    if (!imageData) {
      throw new Error('Image data is required');
    }
    if (!mimeType) {
      throw new Error('MIME type is required');
    }
    if (!mimeType.startsWith('image/')) {
      throw new Error(`Invalid MIME type: ${mimeType}. Expected image type.`);
    }

    // Validate base64 image data format (basic check)
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    if (!base64Regex.test(imageData)) {
      logger.warn(`Invalid base64 format detected. Data length: ${imageData.length}, starts with: ${imageData.substring(0, 50)}`);
    }

    logger.info(`Processing image with Gemini - size: ${imageData.length} chars, mimeType: ${mimeType}`);

    const modelConfig = {
      temperature: 0,
      thinkingConfig: {
        // Gemini 3.x takes a thinking level; LOW was enough for page extraction in the bake-off
        thinkingLevel: 'LOW',
      },
      responseMimeType: 'application/json',
      systemInstruction: [
        {
          text: this.getDigitalMuhaqqiqPrompt(),
        },
      ],
    };

    const contents = [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType,
              data: imageData,
            },
          },
        ],
      },
    ];

    const { imageToText, imageToTextFallback, imageToTextTimeoutMs } = config.geminiModels;
    try {
      return await this.extractWithModel(imageToText, modelConfig, contents, imageToTextTimeoutMs);
    } catch (error) {
      // An overloaded, slow or retired primary model should not stop the reader
      if (!imageToTextFallback || imageToTextFallback === imageToText || !this.isUnavailableError(error)) {
        throw error;
      }
      logger.warn(`Image-to-text model ${imageToText} unavailable (${error.message.slice(0, 120)}); falling back to ${imageToTextFallback}`);
      return this.extractWithModel(imageToTextFallback, modelConfig, contents, imageToTextTimeoutMs);
    }
  }

  isUnavailableError(error) {
    // The SDK wraps an aborted request in a generic Error whose message names AbortError
    return error.name === 'AbortError' || /\b(404|429|500|503)\b|abort|high demand|overloaded|timed out/i.test(error.message || '');
  }

  async extractWithModel(model, modelConfig, contents, timeoutMs) {
    logger.debug(`Calling Gemini model ${model} for image-to-text conversion`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.ai.models.generateContentStream({
        model,
        config: { ...modelConfig, abortSignal: controller.signal },
        contents,
      });

      let fullText = '';
      for await (const chunk of response) {
        try {
          if (chunk.text && typeof chunk.text === 'function') {
            fullText += chunk.text();
          } else if (chunk.candidates && chunk.candidates[0] && chunk.candidates[0].content) {
            const parts = chunk.candidates[0].content.parts;
            if (parts && parts.length > 0 && parts[0].text) {
              fullText += parts[0].text;
            }
          }
        } catch (chunkError) {
          logger.warn('Skipping problematic chunk:', chunkError.message);
        }
      }

      return this.parseResponse(fullText);
    } catch (error) {
      logger.error(`Error in Gemini image-to-text processing (${model}):`, error);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Generate audio from text
   * @param {string} text - Text to convert to audio
   * @param {string} [voiceName='Sadaltager'] - Voice name to use
   * @param {string} [systemInstruction] - Optional system instruction for style control
   * @returns {Promise<Object>} - Object containing audio data and mime type
   */
  async generateAudio(text, voiceName = '6tager', systemInstruction = null) {
    const truncatedText = text.length > config.maxTextLength
      ? text.substring(0, config.maxTextLength) + "..."
      : text;

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

    const model = config.geminiModels.textToAudio;
    const contents = [
      {
        parts: [
          {
            text: truncatedText
          }
        ]
      }
    ];

    logger.debug(`Calling Gemini model ${model} for text-to-audio conversion`);

    return this.retryWithBackoff(async () => {
      try {
        const request = {
          model,
          contents,
          config: modelConfig,
        };

        // A senior developer approach: enforce strict modality in system instructions
        // This prevents the model from "thinking out loud" or generating text preludes
        const strictAudioInstruction = "IMPORTANT: You are a TTS (Text-to-Speech) engine. You MUST ONLY generate audio. Do NOT generate any text, explanations, or preludes. Your response must be 100% audio data.";

        const finalSystemInstruction = systemInstruction
          ? `${systemInstruction}\n\n${strictAudioInstruction}`
          : strictAudioInstruction;

        if (finalSystemInstruction) {
          request.systemInstruction = {
            parts: [{ text: finalSystemInstruction }]
          };
        }

        const response = await this.ai.models.generateContent(request);

        const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!audioData) {
          throw new Error('No audio data in response');
        }

        return {
          data: audioData,
          mimeType: response.candidates[0].content.parts[0].inlineData.mimeType || ''
        };
      } catch (error) {
        logger.error('Error in Gemini text-to-audio processing:', error);
        throw error;
      }
    });
  }

  /**
   * Retry an operation with exponential backoff
   * @param {Function} operation - Async operation to retry
   * @returns {Promise<any>} - Result of the operation
   */
  async retryWithBackoff(operation) {
    let attempts = 0;
    const maxAttempts = config.maxRetries;

    while (attempts < maxAttempts) {
      try {
        return await operation();
      } catch (error) {
        attempts++;

        if (error.message && error.message.includes('429') && attempts < maxAttempts) {
          const waitTime = Math.pow(2, attempts) * config.retryDelay;
          logger.warn(`Rate limited, waiting ${waitTime}ms before retry ${attempts} of ${maxAttempts}`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }

        throw error;
      }
    }
  }

  /**
   * Parse JSON response from Gemini
   * @param {string} fullText - Response text from Gemini
   * @returns {Object} - Parsed JSON or fallback object
   */
  parseResponse(fullText) {
    if (!fullText || fullText.trim() === '') {
      throw new Error('Gemini returned an empty response');
    }

    try {
      return JSON.parse(fullText);
    } catch (parseError) {
      logger.error('Failed to parse JSON response from Gemini:', {
        error: parseError.message,
        text: fullText.substring(0, 500)
      });
      throw new Error('Failed to parse extraction result as JSON');
    }
  }

  /**
   * Get the Digital Muhaqqiq system prompt
   * @returns {string} - System prompt
   */
  getDigitalMuhaqqiqPrompt() {
    return `System Prompt: The Digital Muhaqqiq (المُحَقِّق الرقمي)
Your Persona: You are the "Digital Muhaqqiq" (المُحَقِّق الرقمي), an AI assistant with the precision and scholarly diligence of a traditional manuscript editor. Your expertise lies in analyzing scanned pages of classical and modern Arabic books. Your primary function is to meticulously identify, extract, and structure the text, ensuring its integrity and readability. You honor the original author's intent by preserving the distinct structural elements of the page.

Your Core Mission: Given an image of a single page from a scanned Arabic book, your task is to:

Analyze the page's layout to distinguish between the three primary textual zones: Header, Body, and Footer/Footnotes.

Accurately perform Optical Character Recognition (OCR) on the text within each zone.

Apply tashkeel (diacritics/vocalization) with scholarly judgment if it is present in the source, or infer it logically based on context to ensure correct pronunciation and meaning.

Output a clean, structured JSON object containing the extracted text, precisely separated into the identified zones.

Processing Workflow:

Layout Analysis:

Header (header): Scan the top section of the page. Identify recurring elements such as the book title, chapter title (فصل or باب), or section headings. This text is often stylistically distinct, centered, or in a larger font. If no distinct header is present, this field should be an empty string "".

Body (body): This is the main block of text containing the primary content of the page. It is typically the largest and most contiguous section of prose or poetry. Extract this text as a single, coherent block, preserving paragraph breaks with \n. Note any footnote markers (e.g., (١)) within the body, but leave the corresponding footnote text for the footer section.

Footer (footer): Examine the bottom of the page, which is often separated from the body by a horizontal line. This zone contains footnotes/references (الحواشي السفلية), the page number, and sometimes publisher's notes. Your primary task here is to extract the numbered footnotes, preserving their numbering and structure. Extract all footnote text, followed by the page number. If no footer elements are present, this field should be an empty string "".

Text Extraction and Refinement:

Accuracy is paramount. Your OCR must be flawless. Pay close attention to the nuances of Arabic script, including ligatures, overlapping characters, and various calligraphic styles.

Correction: After initial extraction, perform a verification step. Correct any common OCR errors (e.g., confusing د and ر, or س and ش). Ensure all words are contextually correct.

Tashkeel Integrity: Preserve all diacritics as found in the source image. If the source text is unvocalized, do not invent diacritics unless it is necessary to resolve a critical ambiguity, and do so with the utmost confidence based on classical grammar (نحو).

Output Format (JSON):

You MUST structure your final output as a single JSON object.

The object must contain three keys: header, body, and footer.

The value for each key must be a string containing the extracted and corrected Arabic text for that zone.

Example Interaction:

User provides: <image>

Your Expected Output:

{
  "header": "الفصل الثاني في آداب المتعلم",
  "body": "ومن آداب المتعلم أن يكون فارغ القلب من الشواغل الدنيوية والعلائق البدنية، فإن الفكرة إذا توزعت قصرت عن إدراك الحقائق وغموض الدقائق. ولهذا قيل: العلم لا يعطيك بعضه حتى تعطيه كلك.(١)\nفينبغي للمتعلم أن يجتهد في تحصيل العلم ويقلل من العلائق الدنيوية، فإنها تشغل القلب وتضيع الوقت.",
  "footer": "(١) انظر: إحياء علوم الدين للإمام الغزالي، ج١، ص ٥٢.\n٤٢"
}

Final Instruction: Execute your mission with the focus and scholarly integrity of a true Muhaqqiq. The quality of your output is a reflection of your dedication to preserving and transmitting knowledge. Begin.`;
  }
}

module.exports = new GeminiService();
