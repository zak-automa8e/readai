const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { GoogleGenAI } = require('@google/genai');
const mime = require('mime');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS for all routes
app.use(cors());

// Middleware to parse JSON
app.use(express.json({ limit: '10mb' }));

// Get Gemini API Key from environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY environment variable not set.");
}

const ai = new GoogleGenAI({
  apiKey: GEMINI_API_KEY,
});

// PDF proxy endpoint
app.get('/api/pdf-proxy', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: 'URL parameter is required' });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Fetch the PDF from the external URL
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ReadAI-PDF-Proxy/1.0'
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ 
        error: `Failed to fetch PDF: ${response.statusText}` 
      });
    }

    // Get the content type
    const contentType = response.headers.get('content-type');
    
    // Verify it's a PDF
    if (!contentType || !contentType.includes('application/pdf')) {
      return res.status(400).json({ 
        error: 'URL does not point to a PDF file' 
      });
    }

    // Set appropriate headers
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept'
    });

    // Stream the PDF content
    response.body.pipe(res);

  } catch (error) {
    res.status(500).json({ 
      error: 'Internal server error while fetching PDF' 
    });
  }
});

// New endpoint for Image-to-Text
app.post('/api/image-to-text', async (req, res) => {
  try {
    const { image } = req.body; // Expecting a base64 encoded image string

    if (!image) {
      return res.status(400).json({ error: 'Image data is required' });
    }

    // Extract mime type and data from base64 string
    let mimeType, data;
    
    if (image.startsWith('data:')) {
      const matches = image.match(/^data:(.+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        return res.status(400).json({ error: 'Invalid image data format' });
      }
      mimeType = matches[1];
      data = matches[2];
    } else {
      // Handle the case where the image might be just raw base64 without data URI
      mimeType = 'image/png'; // Default to PNG
      data = image;
    }
    
    const config = {
      temperature: 0.5,
      thinkingConfig: {
        thinkingBudget: -1,
      },
      responseMimeType: 'application/json',
      systemInstruction: [
        {
          text: `System Prompt: The Digital Muhaqqiq (المُحَقِّق الرقمي)
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

Final Instruction: Execute your mission with the focus and scholarly integrity of a true Muhaqqiq. The quality of your output is a reflection of your dedication to preserving and transmitting knowledge. Begin.
`,
        },
      ],
    };
    
    // Use the updated model name from the sample
    const model = 'gemini-2.5-flash-lite-preview-06-17';
    const contents = [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType,
              data,
            },
          },
        ],
      },
    ];

    // Use streaming as shown in the sample
    const response = await ai.models.generateContentStream({
      model,
      config,
      contents,
    });

    // Process the response stream
    let fullText = '';
    for await (const chunk of response) {
      try {
        if (chunk.text && typeof chunk.text === 'function') {
          fullText += chunk.text();
        } else if (chunk.candidates && chunk.candidates[0] && chunk.candidates[0].content) {
          // Extract text from candidates[0].content.parts[0].text
          const parts = chunk.candidates[0].content.parts;
          if (parts && parts.length > 0 && parts[0].text) {
            fullText += parts[0].text;
          }
        }
      } catch (chunkError) {
        // Skip problematic chunks
      }
    }
    
    // The model should return a JSON string. Parse it safely.
    let jsonData;
    try {
      jsonData = JSON.parse(fullText);
    } catch (parseError) {
      // Try to create a fallback JSON if parsing fails
      jsonData = {
        header: "",
        body: fullText || "Text extraction failed",
        footer: ""
      };
    }

    res.json(jsonData);
  } catch (error) {
    // Add more detailed error information to help diagnose the issue
    res.status(500).json({ 
      error: 'Internal server error while processing image',
      details: error.message,
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
    });
  }
});

// New endpoint for Text-to-Audio
app.post('/api/text-to-audio', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    // Limit text length to avoid overloading the API (adjust as needed)
    const maxTextLength = 1000;
    const truncatedText = text.length > maxTextLength ? 
      text.substring(0, maxTextLength) + "..." : 
      text;
    
    console.log(`Processing text-to-audio request, text length: ${text.length} chars (${truncatedText.length} after truncation if needed)`);

    const config = {
      responseModalities: ['AUDIO'],  // Note the uppercase 'AUDIO' from the sample
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: 'Zephyr',
          }
        }
      },
    };

    // Using the model from the sample
    const model = 'gemini-2.5-flash-preview-tts';  // Changed to match the sample
    
    // Using the contents structure from the sample
    const contents = [
      { 
        parts: [
          { 
            text: truncatedText 
          }
        ] 
      }
    ];

    console.log('Using model:', model);
    console.log('Config:', JSON.stringify(config));

    // Add retry logic for rate limiting
    let attempts = 0;
    const maxAttempts = 3;
    let response;
    
    while (attempts < maxAttempts) {
      try {
        console.log(`Text-to-audio attempt ${attempts + 1} of ${maxAttempts}`);
        
        // Using generateContent instead of generateContentStream to match the sample
        response = await ai.models.generateContent({
          model,
          contents,
          config,
        });
        break; // Success, exit retry loop
      } catch (retryError) {
        attempts++;
        if (retryError.message && retryError.message.includes('429')) {
          const waitTime = Math.pow(2, attempts) * 1000; // Exponential backoff
          console.log(`Rate limited, waiting ${waitTime}ms before retry ${attempts} of ${maxAttempts}`);
          if (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
        }
        // If we get here, either we've exhausted retries or it's not a 429 error
        throw retryError;
      }
    }

    if (!response) {
      throw new Error('Failed to generate audio after retries');
    }
    
    console.log('Response received:', JSON.stringify({
      hasResponse: !!response,
      hasCandidates: !!response.candidates,
      candidateCount: response.candidates ? response.candidates.length : 0,
      responseKeys: Object.keys(response)
    }));

    // Extract audio data directly following the sample
    const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    
    if (!data) {
      console.error('No audio data found in response', response);
      return res.status(500).json({ error: 'No audio data in response' });
    }
    
    console.log('Audio data found, length:', data.length);
    const audioBuffer = Buffer.from(data, 'base64');
    
    // Convert to WAV format if needed
    const mimeType = response.candidates[0].content.parts[0].inlineData.mimeType || '';
    const wavBuffer = convertToWav(data, mimeType);
    
    // Set headers for audio file
    res.set({
      'Content-Type': 'audio/wav',
      'Content-Disposition': 'inline',
      'Access-Control-Allow-Origin': '*',
    });
    
    // Send the complete WAV file
    res.end(wavBuffer);
  } catch (error) {
    console.error('Error in text-to-audio:', error);
    
    let statusCode = 500;
    let errorMessage = 'Internal server error while generating audio';
    
    // Handle specific error types
    if (error.message && error.message.includes('429')) {
      statusCode = 429;
      errorMessage = 'API rate limit exceeded. Please try again later.';
    } else if (error.message && error.message.includes('quota')) {
      statusCode = 429;
      errorMessage = 'API quota exceeded. Please try again later or use a different API key.';
    }
    
    res.status(statusCode).json({ 
      error: errorMessage,
      details: error.message,
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
    });
  }
});

// Helper functions for WAV conversion
function convertToWav(rawData, mimeType) {
  const options = parseMimeType(mimeType);
  const buffer = Buffer.from(rawData, 'base64');
  const wavHeader = createWavHeader(buffer.length, options);
  return Buffer.concat([wavHeader, buffer]);
}

function parseMimeType(mimeType) {
  const [fileType, ...params] = mimeType.split(';').map(s => s.trim());
  const [_, format] = fileType.split('/');

  const options = {
    numChannels: 1,
    sampleRate: 22050, // Default sample rate
    bitsPerSample: 16, // Default bits per sample
  };

  if (format && format.startsWith('L')) {
    const bits = parseInt(format.slice(1), 10);
    if (!isNaN(bits)) {
      options.bitsPerSample = bits;
    }
  }

  for (const param of params) {
    const [key, value] = param.split('=').map(s => s.trim());
    if (key === 'rate') {
      options.sampleRate = parseInt(value, 10);
    }
  }

  return options;
}

function createWavHeader(dataLength, options) {
  const {
    numChannels,
    sampleRate,
    bitsPerSample,
  } = options;

  // http://soundfile.sapp.org/doc/WaveFormat
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const buffer = Buffer.alloc(44);

  buffer.write('RIFF', 0); // ChunkID
  buffer.writeUInt32LE(36 + dataLength, 4); // ChunkSize
  buffer.write('WAVE', 8); // Format
  buffer.write('fmt ', 12); // Subchunk1ID
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(numChannels, 22); // NumChannels
  buffer.writeUInt32LE(sampleRate, 24); // SampleRate
  buffer.writeUInt32LE(byteRate, 28); // ByteRate
  buffer.writeUInt16LE(blockAlign, 32); // BlockAlign
  buffer.writeUInt16LE(bitsPerSample, 34); // BitsPerSample
  buffer.write('data', 36); // Subchunk2ID
  buffer.writeUInt32LE(dataLength, 40); // Subchunk2Size

  return buffer;
}

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

module.exports = app;
