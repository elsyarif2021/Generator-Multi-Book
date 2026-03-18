import { BookParams, ChapterOutline } from '../types';

export async function parseVoiceInput(transcript: string): Promise<Partial<BookParams>> {
  try {
    const response = await fetch('/api/parse-voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript })
    });
    if (!response.ok) throw new Error('Failed to parse voice input');
    return await response.json();
  } catch (e) {
    console.error("Gagal mem-parsing input suara:", e);
    return {};
  }
}

export async function generateOutline(params: BookParams): Promise<ChapterOutline[]> {
  const response = await fetch('/api/generate-outline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ params })
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || 'Failed to generate outline');
  }
  return await response.json();
}

export async function generateChapter(
  params: BookParams, 
  outline: ChapterOutline,
  onChunk?: (text: string) => void
): Promise<string> {
  const response = await fetch('/api/generate-chapter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ params, outline })
  });

  if (!response.ok) {
    let errMsg = 'Failed to generate chapter';
    try {
      const err = await response.json();
      errMsg = err.error || errMsg;
    } catch (e) {}
    throw new Error(errMsg);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        try {
          if (data === '[DONE]') break;
          const parsed = JSON.parse(data);
          if (parsed.error) {
            throw new Error(parsed.error);
          }
          if (parsed.text) {
            fullText += parsed.text;
            if (onChunk) onChunk(parsed.text);
          }
        } catch (e: any) {
          if (e.message && e.message !== 'Unexpected end of JSON input' && !e.message.includes('Unexpected token')) {
            throw e; // Re-throw actual API errors
          }
          // ignore parse errors for incomplete chunks
        }
      }
    }
  }

  return fullText;
}

export async function generateChapterImage(
  params: BookParams,
  outline: ChapterOutline
): Promise<string | null> {
  try {
    const response = await fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ params, outline })
    });
    if (!response.ok) throw new Error('Failed to generate image');
    const data = await response.json();
    return data.imageUrl || null;
  } catch (e) {
    console.error("Gagal menghasilkan gambar:", e);
    return null;
  }
}

export async function generateSpeech(text: string): Promise<string | null> {
  try {
    const response = await fetch('/api/generate-speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    if (!response.ok) throw new Error('Failed to generate speech');
    const data = await response.json();
    return data.audioUrl || null;
  } catch (e) {
    console.error("Gagal men-generate suara:", e);
    return null;
  }
}
