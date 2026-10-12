// One tiny TTS call per model to read the 429 quota detail (violated metric + retry delay). Prints no secrets.
const path = require('path');
const config = require(path.join(process.cwd(), 'src/config'));
const { GoogleGenAI } = require(require.resolve('@google/genai', { paths: [process.cwd()] }));
(async () => {
  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  for (const model of process.argv.slice(2)) {
    try {
      const r = await ai.models.generateContent({ model, contents: [{ parts: [{ text: 'مرحبا' }] }], config: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } } } });
      console.log(model, 'OK', JSON.stringify(r.usageMetadata));
    } catch (e) {
      const m = String(e.message);
      const i = m.indexOf('{');
      try { const j = JSON.parse(m.slice(i)); console.log(model, j.error.code, JSON.stringify((j.error.details || []).filter(d => /QuotaFailure|RetryInfo/.test(d['@type'])))); } catch { console.log(model, m.slice(0, 600)); }
    }
  }
})();
