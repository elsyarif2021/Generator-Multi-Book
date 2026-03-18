import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type, ThinkingLevel, Modality } from '@google/genai';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getAIClient() {
  let key = process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (key) key = key.trim();
  console.log('Env keys:', Object.keys(process.env).filter(k => k.includes('KEY') || k.includes('GEMINI')));
  console.log('API Key length:', key ? key.length : 0);
  if (!key || key === 'undefined' || key === 'null') {
    throw new Error(`GEMINI_API_KEY environment variable is missing or invalid. Value: "${key}". Please configure it to use AI features.`);
  }
  return new GoogleGenAI({ apiKey: key });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  app.post('/api/parse-voice', async (req, res) => {
    try {
      const ai = getAIClient();
      const { transcript } = req.body;
      const prompt = `
Anda adalah asisten AI yang mengekstrak parameter buku dari input suara pengguna.
Input pengguna: "${transcript}"

Tugas Anda:
Ekstrak parameter berikut jika disebutkan. Jika tidak disebutkan, JANGAN sertakan field tersebut dalam JSON (biarkan undefined).
Kembalikan HANYA JSON valid.

Field yang diizinkan dan tipe datanya:
- title: string (Judul buku)
- type: string ("FICTION", "NON_FICTION", atau "STORY_BOOK")
- genre: string (Pilih salah satu yang paling mendekati: Fantasy, Sci-Fi, Cyberpunk, Romance, Thriller, Horror, Mystery, Historical Fiction, Slice of Life, Action/Adventure, Psikologi Industri, Sejarah, Bisnis & Ekonomi, Teknologi & IT, Self-Improvement, Sains Populer, Filsafat, Biografi, Pendidikan, Kesehatan, Dongeng / Fairy Tale, Fabel, Petualangan Anak, Mitos & Legenda, Sci-Fi Anak, Edukasi Bergambar)
- tone: string (Pilih salah satu yang paling mendekati: Melankolis, Gritty, Akademis Formal, Populer, Humoris, Inspiratif, Gelap/Dark, Objektif/Kritis, Santai/Kasual, Puitis)
- targetAudience: string (Pilih salah satu yang paling mendekati: Anak-anak, Remaja (YA), Dewasa Muda (NA), Dewasa, Mahasiswa S1/S2, Profesional IT, Akademisi/Peneliti, Masyarakat Umum)
- chapterCount: number (Jumlah bab)
- wordsPerChapter: number (Jumlah kata per bab)
- referenceCount: number (Jumlah referensi)
`;
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        }
      });
      res.json(JSON.parse(response.text || '{}'));
    } catch (e: any) {
      console.error("Gagal mem-parsing input suara:", e);
      const errorMessage = e.message || 'Failed to parse voice input';
      if (errorMessage.includes('API key not valid')) {
        res.status(400).json({ error: 'API Key Gemini tidak valid atau tidak ditemukan.' });
      } else {
        res.status(500).json({ error: errorMessage });
      }
    }
  });

  app.post('/api/generate-outline', async (req, res) => {
    try {
      const ai = getAIClient();
      const { params } = req.body;
      const prompt = `
Anda adalah AI Engineer dan Penulis Profesional (The Multi-Genre Architect v3.0).
Tugas Anda: Buat Outline Detail per bab berdasarkan input berikut:
1. JUDUL: ${params.title}
2. JENIS BUKU: ${params.type === 'FICTION' ? 'Fiksi/Novel' : 'Akademik/Non-Fiksi'}
3. GENRE/BIDANG: ${params.genre}
4. TONE: ${params.tone}
5. TARGET PEMBACA: ${params.targetAudience}
6. JUMLAH BAB: ${params.chapterCount} Bab

LOGIKA PEMROSESAN:
- JIKA BUKU AKADEMIK/UMUM: Gunakan struktur: Pendahuluan, Landasan Teori, Metodologi/Analisis, dan Kesimpulan.
- JIKA NOVEL/FIKSI: Gunakan struktur: Story Arc (Inciting Incident, Rising Action, Climax, Resolution).
- JIKA STORY BOOK: Gunakan struktur cerita bergambar yang sederhana, visual, dan menarik untuk anak-anak atau pembaca visual.

Kembalikan outline sebagai array JSON dengan properti: chapterNumber (angka), title (string), dan description (string ringkasan isi bab).
`;
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                chapterNumber: { type: Type.INTEGER },
                title: { type: Type.STRING },
                description: { type: Type.STRING },
              },
              required: ['chapterNumber', 'title', 'description'],
            },
          },
        },
      });
      res.json(JSON.parse(response.text || '[]'));
    } catch (e: any) {
      console.error("Gagal membuat outline:", e);
      const errorMessage = e.message || 'Failed to generate outline';
      if (errorMessage.includes('API key not valid')) {
        res.status(400).json({ error: 'API Key Gemini tidak valid atau tidak ditemukan.' });
      } else {
        res.status(500).json({ error: errorMessage });
      }
    }
  });

  app.post('/api/generate-chapter', async (req, res) => {
    try {
      const ai = getAIClient();
      const { params, outline } = req.body;
      const prompt = `
Anda adalah AI Engineer dan Penulis Profesional (The Multi-Genre Architect v3.0).
Tugas Anda: Tulis Bab ${outline.chapterNumber} secara mendalam (Deep Writing) berdasarkan parameter berikut:

1. JUDUL BUKU: ${params.title}
2. JENIS BUKU: ${params.type === 'FICTION' ? 'Fiksi/Novel' : params.type === 'NON_FICTION' ? 'Akademik/Non-Fiksi' : 'Buku Cerita Bergambar (Story Book)'}
3. GENRE/BIDANG: ${params.genre}
4. TONE: ${params.tone}
5. TARGET PEMBACA: ${params.targetAudience}
6. TARGET KATA: Sekitar ${params.wordsPerChapter} kata.
7. REFERENSI: ${params.type === 'NON_FICTION' ? `${params.referenceCount} referensi per bab` : 'Abaikan (Fiksi/Story Book)'}

DETAIL BAB INI:
- Judul Bab: ${outline.title}
- Deskripsi/Outline Bab: ${outline.description}

LOGIKA PEMROSESAN:
${params.type === 'NON_FICTION' 
  ? `- Gunakan bahasa yang objektif, analitis, dan informatif.\n- Tambahkan sitasi (In-text citation) bergaya APA/Harvard.\n- Di akhir bab, sertakan daftar "Referensi" sebanyak ${params.referenceCount} buah.` 
  : params.type === 'FICTION'
  ? `- Fokus pada "Show, Don't Tell", dialog organik, dan pembangunan suasana (world building).\n- ABAIKAN parameter referensi (tidak perlu daftar pustaka).`
  : `- Tulis dengan bahasa yang sangat visual, imajinatif, dan mudah dipahami.\n- Fokus pada deskripsi adegan yang indah dan karakter yang menarik.\n- Cocok untuk disandingkan dengan ilustrasi gambar.`}

Tuliskan isi bab ini dalam format Markdown. Jangan sertakan judul bab di awal teks (hanya isinya saja).
`;
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const responseStream = await ai.models.generateContentStream({
        model: 'gemini-3.1-pro-preview',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }
        }
      });

      for await (const chunk of responseStream) {
        const chunkText = chunk.text || '';
        res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } catch (e: any) {
      console.error("Gagal menulis bab:", e);
      const errorMessage = e.message || 'Failed to generate chapter';
      if (errorMessage.includes('API key not valid')) {
        res.write(`data: ${JSON.stringify({ error: 'API Key Gemini tidak valid atau tidak ditemukan.' })}\n\n`);
      } else {
        res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
      }
      res.end();
    }
  });

  app.post('/api/generate-image', async (req, res) => {
    try {
      const ai = getAIClient();
      const { params, outline } = req.body;
      const prompt = `Sebuah ilustrasi untuk buku cerita berjudul "${params.title}".
Genre: ${params.genre}. Tone: ${params.tone}.
Adegan: ${outline.title}. ${outline.description}.
Gaya visual: Ilustrasi buku cerita anak yang indah, penuh warna, dan imajinatif.`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: prompt,
        config: {
          imageConfig: {
            aspectRatio: "1:1"
          }
        }
      });

      let imageUrl = null;
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          break;
        }
      }
      res.json({ imageUrl });
    } catch (e: any) {
      console.error("Gagal menghasilkan gambar:", e);
      const errorMessage = e.message || 'Failed to generate image';
      if (errorMessage.includes('API key not valid')) {
        res.status(400).json({ error: 'API Key Gemini tidak valid atau tidak ditemukan.' });
      } else {
        res.status(500).json({ error: errorMessage });
      }
    }
  });

  app.post('/api/generate-speech', async (req, res) => {
    try {
      const ai = getAIClient();
      const { text } = req.body;
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        res.json({ audioUrl: `data:audio/wav;base64,${base64Audio}` });
      } else {
        res.status(500).json({ error: 'No audio data returned' });
      }
    } catch (e: any) {
      console.error("Gagal men-generate suara:", e);
      const errorMessage = e.message || 'Failed to generate speech';
      if (errorMessage.includes('API key not valid')) {
        res.status(400).json({ error: 'API Key Gemini tidak valid atau tidak ditemukan.' });
      } else {
        res.status(500).json({ error: errorMessage });
      }
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
