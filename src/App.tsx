import React, { useState, useEffect, useRef } from 'react';
import { BookOpen, Settings, PenTool, Download, ChevronRight, Loader2, CheckCircle2, AlertCircle, Volume2, Square, LogIn, LogOut, Save, Library, Palette } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { BookParams, BookType, ChapterOutline, ChapterContent } from './types';
import { generateOutline, generateChapter, generateChapterImage, generateSpeech } from './lib/gemini';
import { exportToDocx } from './lib/docxExport';
import { auth, db } from './firebase';
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { collection, addDoc, getDocs, query, where, serverTimestamp, getDocFromServer, doc } from 'firebase/firestore';

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

type Phase = 'SETUP' | 'BLUEPRINTING' | 'WRITING' | 'DONE';
type Theme = 'light' | 'dark' | 'blue-sky' | 'hijau-daun' | 'navy' | 'hijau-army' | 'maca';

const FICTION_GENRES = ['Fantasy', 'Sci-Fi', 'Cyberpunk', 'Romance', 'Thriller', 'Horror', 'Mystery', 'Historical Fiction', 'Slice of Life', 'Action/Adventure'];
const NON_FICTION_GENRES = ['Psikologi Industri', 'Sejarah', 'Bisnis & Ekonomi', 'Teknologi & IT', 'Self-Improvement', 'Sains Populer', 'Filsafat', 'Biografi', 'Pendidikan', 'Kesehatan'];
const STORY_BOOK_GENRES = ['Dongeng / Fairy Tale', 'Fabel', 'Petualangan Anak', 'Mitos & Legenda', 'Sci-Fi Anak', 'Edukasi Bergambar'];
const TONES = ['Melankolis', 'Gritty', 'Akademis Formal', 'Populer', 'Humoris', 'Inspiratif', 'Gelap/Dark', 'Objektif/Kritis', 'Santai/Kasual', 'Puitis'];
const AUDIENCES = ['Anak-anak', 'Remaja (YA)', 'Dewasa Muda (NA)', 'Dewasa', 'Mahasiswa S1/S2', 'Profesional IT', 'Akademisi/Peneliti', 'Masyarakat Umum'];

const THEMES: Record<Theme, { bg: string, text: string, cardBg: string, cardBorder: string, primary: string, primaryHover: string, inputBg: string, inputText: string }> = {
  'light': { bg: 'bg-slate-50', text: 'text-slate-900', cardBg: 'bg-white', cardBorder: 'border-slate-200', primary: 'bg-indigo-600', primaryHover: 'hover:bg-indigo-700', inputBg: 'bg-white', inputText: 'text-slate-900' },
  'dark': { bg: 'bg-slate-950', text: 'text-slate-100', cardBg: 'bg-slate-900', cardBorder: 'border-slate-800', primary: 'bg-indigo-500', primaryHover: 'hover:bg-indigo-600', inputBg: 'bg-slate-800', inputText: 'text-slate-100' },
  'blue-sky': { bg: 'bg-sky-50', text: 'text-sky-950', cardBg: 'bg-white', cardBorder: 'border-sky-200', primary: 'bg-sky-600', primaryHover: 'hover:bg-sky-700', inputBg: 'bg-white', inputText: 'text-sky-900' },
  'hijau-daun': { bg: 'bg-green-50', text: 'text-green-950', cardBg: 'bg-white', cardBorder: 'border-green-200', primary: 'bg-green-600', primaryHover: 'hover:bg-green-700', inputBg: 'bg-white', inputText: 'text-green-900' },
  'navy': { bg: 'bg-blue-950', text: 'text-blue-50', cardBg: 'bg-blue-900', cardBorder: 'border-blue-800', primary: 'bg-blue-500', primaryHover: 'hover:bg-blue-600', inputBg: 'bg-blue-950', inputText: 'text-blue-50' },
  'hijau-army': { bg: 'bg-emerald-950', text: 'text-emerald-50', cardBg: 'bg-emerald-900', cardBorder: 'border-emerald-800', primary: 'bg-emerald-600', primaryHover: 'hover:bg-emerald-700', inputBg: 'bg-emerald-950', inputText: 'text-emerald-50' },
  'maca': { bg: 'bg-stone-100', text: 'text-stone-900', cardBg: 'bg-amber-50', cardBorder: 'border-amber-200', primary: 'bg-amber-700', primaryHover: 'hover:bg-amber-800', inputBg: 'bg-white', inputText: 'text-stone-900' },
};

export default function App() {
  const [phase, setPhase] = useState<Phase>('SETUP');
  const [theme, setTheme] = useState<Theme>('light');
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(true); // Assume true initially
  
  useEffect(() => {
    const checkApiKey = async () => {
      if (window.aistudio && window.aistudio.hasSelectedApiKey) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(hasKey);
      }
    };
    checkApiKey();
  }, []);

  const handleSelectApiKey = async () => {
    if (window.aistudio && window.aistudio.openSelectKey) {
      await window.aistudio.openSelectKey();
      // Assume success to avoid race conditions
      setHasApiKey(true);
    }
  };
  
  const [params, setParams] = useState<BookParams>({
    title: '',
    type: 'FICTION',
    genre: FICTION_GENRES[0],
    tone: TONES[0],
    targetAudience: AUDIENCES[0],
    chapterCount: 5,
    wordsPerChapter: 1500,
    referenceCount: 5,
  });
  
  const [outlines, setOutlines] = useState<ChapterOutline[]>([]);
  const [chapters, setChapters] = useState<ChapterContent[]>([]);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingImageUrl, setStreamingImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedBooks, setSavedBooks] = useState<any[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  
  // Text-to-Speech State
  const [isReading, setIsReading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    
    // Test Firestore connection
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (user && showLibrary) {
      loadSavedBooks();
    }
  }, [user, showLibrary]);

  useEffect(() => {
    // Apply theme to body
    const t = THEMES[theme];
    document.body.className = `${t.bg} ${t.text} transition-colors duration-300`;
  }, [theme]);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      setError("Gagal login: " + err.message);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setSavedBooks([]);
      setShowLibrary(false);
    } catch (err: any) {
      setError("Gagal logout: " + err.message);
    }
  };

  const handleFirestoreError = (error: unknown, operationType: string, path: string | null) => {
    const errInfo = {
      error: error instanceof Error ? error.message : String(error),
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
        emailVerified: auth.currentUser?.emailVerified,
        isAnonymous: auth.currentUser?.isAnonymous,
        tenantId: auth.currentUser?.tenantId,
        providerInfo: auth.currentUser?.providerData.map(provider => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL
        })) || []
      },
      operationType,
      path
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    throw new Error(JSON.stringify(errInfo));
  };

  const loadSavedBooks = async () => {
    if (!user) return;
    try {
      const q = query(collection(db, 'books'), where('uid', '==', user.uid));
      const querySnapshot = await getDocs(q);
      const books = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSavedBooks(books);
    } catch (err: any) {
      if (err instanceof Error && err.message.includes("Missing or insufficient permissions")) {
        handleFirestoreError(err, 'get', 'books');
      }
      console.error("Gagal memuat buku:", err);
      setError("Gagal memuat buku dari database.");
    }
  };

  const saveBookToDatabase = async () => {
    if (!user) {
      setError("Anda harus login untuk menyimpan buku.");
      return;
    }
    setIsProcessing(true);
    try {
      await addDoc(collection(db, 'books'), {
        uid: user.uid,
        title: params.title,
        type: params.type,
        genre: params.genre,
        tone: params.tone,
        targetAudience: params.targetAudience,
        chapters: chapters,
        createdAt: serverTimestamp()
      });
      alert("Buku berhasil disimpan ke database!");
    } catch (err: any) {
      if (err instanceof Error && err.message.includes("Missing or insufficient permissions")) {
        handleFirestoreError(err, 'create', 'books');
      }
      console.error("Gagal menyimpan buku:", err);
      setError("Gagal menyimpan buku ke database.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReadAloud = async (text: string) => {
    if (isReading) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setIsReading(false);
      return;
    }

    setIsProcessing(true);
    setError(null);
    try {
      // Clean markdown syntax for better reading
      const cleanText = text.replace(/[#*`_]/g, '');
      const url = await generateSpeech(cleanText);
      
      if (url) {
        setAudioUrl(url);
        setIsReading(true);
        // Play audio in next tick after state updates
        setTimeout(() => {
          if (audioRef.current) {
            audioRef.current.play().catch(e => {
              console.error("Audio playback failed", e);
              setIsReading(false);
              setError("Gagal memutar audio.");
            });
          }
        }, 100);
      } else {
        setError("Gagal men-generate suara AI.");
      }
    } catch (err: any) {
      const errMsg = err.message || "Gagal men-generate suara AI.";
      setError(errMsg);
      if (errMsg.includes('API Key Gemini tidak valid') || errMsg.includes('API key not valid') || errMsg.includes('API key is missing')) {
        setHasApiKey(false);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAudioEnded = () => {
    setIsReading(false);
  };

  const handleStartBlueprinting = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    setError(null);
    try {
      const generatedOutlines = await generateOutline(params);
      setOutlines(generatedOutlines);
      setPhase('BLUEPRINTING');
    } catch (err: any) {
      const errMsg = err.message || 'Gagal membuat blueprint.';
      setError(errMsg);
      if (errMsg.includes('API Key Gemini tidak valid') || errMsg.includes('API key not valid') || errMsg.includes('API key is missing')) {
        setHasApiKey(false);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStartWriting = async () => {
    setPhase('WRITING');
    setCurrentChapterIndex(0);
    setChapters([]);
    await writeNextChapter(0, []);
  };

  const writeNextChapter = async (index: number, currentChapters: ChapterContent[]) => {
    if (index >= outlines.length) {
      setPhase('DONE');
      return;
    }

    if (isReading && audioRef.current) {
      audioRef.current.pause();
      setIsReading(false);
    }

    setIsProcessing(true);
    setError(null);
    setStreamingContent('');
    setStreamingImageUrl(null);
    try {
      const outline = outlines[index];
      
      let imageUrlPromise = Promise.resolve<string | null>(null);
      if (params.type === 'STORY_BOOK') {
        imageUrlPromise = generateChapterImage(params, outline).then(url => {
          setStreamingImageUrl(url);
          return url;
        }).catch(e => {
          console.error("Failed to generate image", e);
          return null;
        });
      }

      const content = await generateChapter(params, outline, (chunkText) => {
        setStreamingContent(prev => prev + chunkText);
      });
      
      const imageUrl = await imageUrlPromise;

      const newChapter: ChapterContent = {
        chapterNumber: outline.chapterNumber,
        title: outline.title,
        content: content,
        imageUrl: imageUrl || undefined,
      };
      
      setChapters([...currentChapters, newChapter]);
    } catch (err: any) {
      const errMsg = err.message || `Gagal menulis Bab ${index + 1}.`;
      setError(errMsg);
      if (errMsg.includes('API Key Gemini tidak valid') || errMsg.includes('API key not valid') || errMsg.includes('API key is missing')) {
        setHasApiKey(false);
      }
    } finally {
      setIsProcessing(false);
      setStreamingContent('');
      setStreamingImageUrl(null);
    }
  };

  const handleNextChapter = () => {
    const nextIndex = currentChapterIndex + 1;
    setCurrentChapterIndex(nextIndex);
    writeNextChapter(nextIndex, chapters);
  };

  const handleExport = async () => {
    setIsProcessing(true);
    try {
      await exportToDocx(params.title, chapters);
    } catch (err: any) {
      setError(err.message || 'Gagal mengekspor dokumen.');
    } finally {
      setIsProcessing(false);
    }
  };

  const t = THEMES[theme];

  if (!hasApiKey) {
    return (
      <div className={`min-h-screen ${t.bg} flex items-center justify-center p-4`}>
        <div className={`max-w-md w-full ${t.cardBg} rounded-2xl shadow-xl border ${t.cardBorder} p-8 text-center`}>
          <div className={`w-16 h-16 ${t.primary} rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg`}>
            <Settings className="w-8 h-8 text-white" />
          </div>
          <h2 className={`text-2xl font-bold ${t.text} mb-4`}>Konfigurasi API Key</h2>
          <p className={`${t.text} opacity-80 mb-8`}>
            Aplikasi ini membutuhkan Gemini API Key untuk berfungsi. Silakan pilih atau masukkan API Key Anda dari Google Cloud Project yang memiliki akses ke Gemini API.
          </p>
          <button
            onClick={handleSelectApiKey}
            className={`w-full py-4 px-6 rounded-xl text-white font-medium transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-md flex items-center justify-center space-x-2 ${t.primary} ${t.primaryHover}`}
          >
            <Settings className="w-5 h-5" />
            <span>Pilih API Key</span>
          </button>
          <p className={`mt-6 text-sm ${t.text} opacity-60`}>
            Pelajari lebih lanjut tentang <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="underline">Billing & API Key Gemini</a>.
          </p>
        </div>
      </div>
    );
  }

  // Render Setup Phase
  const renderSetup = () => (
    <div className={`max-w-3xl mx-auto ${t.cardBg} rounded-2xl shadow-sm border ${t.cardBorder} p-8`}>
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center space-x-3">
          <div className={`p-3 ${t.primary} text-white rounded-xl`}>
            <Settings className="w-6 h-6" />
          </div>
          <div>
            <h2 className={`text-2xl font-semibold ${t.text}`}>Parameter Input</h2>
            <p className="opacity-70">Konfigurasi dasar buku Anda</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleStartBlueprinting} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="col-span-2">
            <label className={`block text-sm font-medium ${t.text} mb-2`}>Judul Buku</label>
            <input 
              required
              type="text" 
              value={params.title}
              onChange={e => setParams({...params, title: e.target.value})}
              className={`w-full px-4 py-3 rounded-xl border ${t.cardBorder} focus:ring-2 focus:ring-opacity-50 outline-none transition-all ${t.inputBg} ${t.inputText}`}
              placeholder="Contoh: Sang Alkemis Digital"
            />
          </div>

          <div>
            <label className={`block text-sm font-medium ${t.text} mb-2`}>Jenis Buku</label>
            <select 
              value={params.type}
              onChange={e => {
                const newType = e.target.value as BookType;
                setParams({
                  ...params, 
                  type: newType,
                  genre: newType === 'FICTION' ? FICTION_GENRES[0] : newType === 'NON_FICTION' ? NON_FICTION_GENRES[0] : STORY_BOOK_GENRES[0]
                });
              }}
              className={`w-full px-4 py-3 rounded-xl border ${t.cardBorder} focus:ring-2 focus:ring-opacity-50 outline-none transition-all ${t.inputBg} ${t.inputText}`}
            >
              <option value="FICTION">Fiksi / Novel</option>
              <option value="NON_FICTION">Akademik / Non-Fiksi</option>
              <option value="STORY_BOOK">Buku Cerita Bergambar (Story Book)</option>
            </select>
          </div>

          <div>
            <label className={`block text-sm font-medium ${t.text} mb-2`}>Genre / Bidang</label>
            <select 
              required
              value={params.genre}
              onChange={e => setParams({...params, genre: e.target.value})}
              className={`w-full px-4 py-3 rounded-xl border ${t.cardBorder} focus:ring-2 focus:ring-opacity-50 outline-none transition-all ${t.inputBg} ${t.inputText}`}
            >
              {(params.type === 'FICTION' ? FICTION_GENRES : params.type === 'NON_FICTION' ? NON_FICTION_GENRES : STORY_BOOK_GENRES).map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={`block text-sm font-medium ${t.text} mb-2`}>Tone / Gaya Bahasa</label>
            <select 
              required
              value={params.tone}
              onChange={e => setParams({...params, tone: e.target.value})}
              className={`w-full px-4 py-3 rounded-xl border ${t.cardBorder} focus:ring-2 focus:ring-opacity-50 outline-none transition-all ${t.inputBg} ${t.inputText}`}
            >
              {TONES.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={`block text-sm font-medium ${t.text} mb-2`}>Target Pembaca</label>
            <select 
              required
              value={params.targetAudience}
              onChange={e => setParams({...params, targetAudience: e.target.value})}
              className={`w-full px-4 py-3 rounded-xl border ${t.cardBorder} focus:ring-2 focus:ring-opacity-50 outline-none transition-all ${t.inputBg} ${t.inputText}`}
            >
              {AUDIENCES.map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={`block text-sm font-medium ${t.text} mb-2`}>Jumlah Bab</label>
            <input 
              required
              type="number" 
              min="1"
              max="20"
              value={params.chapterCount}
              onChange={e => setParams({...params, chapterCount: parseInt(e.target.value) || 1})}
              className={`w-full px-4 py-3 rounded-xl border ${t.cardBorder} focus:ring-2 focus:ring-opacity-50 outline-none transition-all ${t.inputBg} ${t.inputText}`}
            />
          </div>

          <div>
            <label className={`block text-sm font-medium ${t.text} mb-2`}>Target Kata per Bab</label>
            <input 
              required
              type="number" 
              min="100"
              max="5000"
              step="100"
              value={params.wordsPerChapter}
              onChange={e => setParams({...params, wordsPerChapter: parseInt(e.target.value) || 100})}
              className={`w-full px-4 py-3 rounded-xl border ${t.cardBorder} focus:ring-2 focus:ring-opacity-50 outline-none transition-all ${t.inputBg} ${t.inputText}`}
            />
          </div>

          {params.type === 'NON_FICTION' && (
            <div>
              <label className={`block text-sm font-medium ${t.text} mb-2`}>Jumlah Referensi per Bab</label>
              <input 
                required
                type="number" 
                min="0"
                max="20"
                value={params.referenceCount}
                onChange={e => setParams({...params, referenceCount: parseInt(e.target.value) || 0})}
                className={`w-full px-4 py-3 rounded-xl border ${t.cardBorder} focus:ring-2 focus:ring-opacity-50 outline-none transition-all ${t.inputBg} ${t.inputText}`}
              />
            </div>
          )}
        </div>

        {error && (
          <div className="p-4 bg-red-50 text-red-600 rounded-xl flex items-center space-x-2">
            <AlertCircle className="w-5 h-5" />
            <span>{error}</span>
          </div>
        )}

        <div className="pt-6 border-t border-opacity-20 border-current flex justify-end">
          <button 
            type="submit"
            disabled={isProcessing}
            className={`flex items-center space-x-2 ${t.primary} ${t.primaryHover} text-white px-8 py-3 rounded-xl font-medium transition-all disabled:opacity-70`}
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Membuat Blueprint...</span>
              </>
            ) : (
              <>
                <span>Buat Blueprint (Phase 1)</span>
                <ChevronRight className="w-5 h-5" />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );

  // Render Blueprinting Phase
  const renderBlueprinting = () => (
    <div className="max-w-4xl mx-auto">
      <div className={`${t.cardBg} rounded-2xl shadow-sm border ${t.cardBorder} p-8 mb-6`}>
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-3">
            <div className={`p-3 ${t.primary} text-white rounded-xl`}>
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <h2 className={`text-2xl font-semibold ${t.text}`}>Phase 1: Blueprint Selesai</h2>
              <p className="opacity-70">Outline buku Anda telah berhasil dibuat.</p>
            </div>
          </div>
          <button 
            onClick={() => setPhase('SETUP')}
            className="opacity-70 hover:opacity-100 text-sm font-medium"
          >
            Kembali Edit Parameter
          </button>
        </div>

        <div className="space-y-4 mb-8">
          {outlines.map((outline, idx) => (
            <div key={idx} className={`p-5 rounded-xl border ${t.cardBorder} ${t.inputBg}`}>
              <h3 className={`font-semibold ${t.text} text-lg mb-2`}>Bab {outline.chapterNumber}: {outline.title}</h3>
              <p className="opacity-80 leading-relaxed">{outline.description}</p>
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <button 
            onClick={handleStartWriting}
            className={`flex items-center space-x-2 ${t.primary} ${t.primaryHover} text-white px-8 py-3 rounded-xl font-medium transition-all`}
          >
            <span>Mulai Phase 2 (Deep Writing)</span>
            <PenTool className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );

  // Render Writing Phase
  const renderWriting = () => {
    const currentChapter = chapters[currentChapterIndex];
    const outline = outlines[currentChapterIndex];
    
    const displayContent = isProcessing ? streamingContent : (currentChapter?.content || '');
    const displayImage = isProcessing ? streamingImageUrl : (currentChapter?.imageUrl || null);
    const wordCount = displayContent.trim().split(/\\s+/).filter(w => w.length > 0).length;

    return (
      <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Sidebar Outline */}
        <div className="lg:col-span-1 space-y-4">
          <div className={`${t.cardBg} rounded-2xl shadow-sm border ${t.cardBorder} p-6 sticky top-8`}>
            <h3 className={`font-semibold ${t.text} mb-4 flex items-center space-x-2`}>
              <BookOpen className="w-5 h-5" />
              <span>Daftar Bab</span>
            </h3>
            <div className="space-y-2">
              {outlines.map((o, idx) => (
                <div 
                  key={idx} 
                  className={`p-3 rounded-lg text-sm flex items-center space-x-3 ${
                    idx === currentChapterIndex 
                      ? `${t.primary} text-white font-medium` 
                      : idx < currentChapterIndex
                        ? 'opacity-70'
                        : 'opacity-40'
                  }`}
                >
                  {idx < currentChapterIndex ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : idx === currentChapterIndex ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border-2 border-current opacity-50" />
                  )}
                  <span className="truncate">Bab {o.chapterNumber}: {o.title}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Main Writing Area */}
        <div className="lg:col-span-2">
          <div className={`${t.cardBg} rounded-2xl shadow-sm border ${t.cardBorder} p-8 min-h-[600px] flex flex-col`}>
            <div className={`border-b ${t.cardBorder} pb-6 mb-6`}>
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-semibold opacity-70 uppercase tracking-wider">Phase 2: Deep Writing</span>
                  <h2 className={`text-2xl font-bold ${t.text} mt-1`}>
                    Bab {outline?.chapterNumber}: {outline?.title}
                  </h2>
                </div>
                <div className="flex items-center space-x-3">
                  {/* Read Aloud Button */}
                  {!isProcessing && displayContent && (
                    <button
                      onClick={() => handleReadAloud(displayContent)}
                      disabled={isProcessing}
                      className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                        isReading 
                          ? 'bg-rose-100 text-rose-600 hover:bg-rose-200' 
                          : `${t.primary} text-white ${t.primaryHover}`
                      }`}
                    >
                      {isReading ? (
                        <>
                          <Square className="w-4 h-4 fill-current" />
                          <span>Berhenti</span>
                        </>
                      ) : (
                        <>
                          <Volume2 className="w-4 h-4" />
                          <span>Bacakan (AI)</span>
                        </>
                      )}
                    </button>
                  )}
                  {/* Word Count Badge */}
                  <div className={`flex items-center space-x-2 ${t.inputBg} px-4 py-2 rounded-xl border ${t.cardBorder}`}>
                    {isProcessing && <Loader2 className="w-4 h-4 animate-spin" />}
                    <span className={`text-sm font-medium ${t.text}`}>
                      {wordCount} Kata
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className={`flex-grow prose max-w-none ${theme === 'dark' || theme === 'navy' || theme === 'hijau-army' ? 'prose-invert' : ''}`}>
              {isProcessing && streamingContent.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center opacity-50 space-y-4 py-20">
                  <Loader2 className="w-10 h-10 animate-spin" />
                  <p>Memulai penulisan Bab {outline?.chapterNumber}...</p>
                </div>
              ) : (displayContent.length > 0) ? (
                <div className="markdown-body">
                  {displayImage && (
                    <div className={`mb-8 rounded-xl overflow-hidden border ${t.cardBorder} shadow-sm`}>
                      <img src={displayImage} alt={`Ilustrasi Bab ${outline?.chapterNumber}`} className="w-full h-auto object-cover max-h-[500px]" referrerPolicy="no-referrer" />
                    </div>
                  )}
                  <ReactMarkdown>{displayContent}</ReactMarkdown>
                  {isProcessing && (
                    <span className="inline-block w-2 h-4 ml-1 bg-current animate-pulse align-middle"></span>
                  )}
                </div>
              ) : null}
            </div>

            {error && (
              <div className="mt-6 p-4 bg-red-50 text-red-600 rounded-xl flex items-center space-x-2">
                <AlertCircle className="w-5 h-5" />
                <span>{error}</span>
              </div>
            )}

            {!isProcessing && currentChapter && (
              <div className={`mt-8 pt-6 border-t ${t.cardBorder} flex justify-end`}>
                <button 
                  onClick={handleNextChapter}
                  className={`flex items-center space-x-2 ${t.primary} ${t.primaryHover} text-white px-8 py-3 rounded-xl font-medium transition-all`}
                >
                  <span>LANJUT (Bab Selanjutnya)</span>
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Render Done Phase
  const renderDone = () => (
    <div className="max-w-2xl mx-auto text-center">
      <div className={`${t.cardBg} rounded-2xl shadow-sm border ${t.cardBorder} p-12`}>
        <div className={`w-20 h-20 ${t.primary} text-white rounded-full flex items-center justify-center mx-auto mb-6`}>
          <CheckCircle2 className="w-10 h-10" />
        </div>
        <h2 className={`text-3xl font-bold ${t.text} mb-4`}>Naskah Selesai!</h2>
        <p className="opacity-80 mb-8 text-lg">
          Seluruh {chapters.length} bab untuk buku "{params.title}" telah berhasil ditulis. 
          Silakan ekspor naskah Anda ke format .docx atau simpan ke database.
        </p>

        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-xl flex items-center justify-center space-x-2 text-left">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-col space-y-4">
          <button 
            onClick={handleExport}
            disabled={isProcessing}
            className={`flex items-center justify-center space-x-3 ${t.primary} ${t.primaryHover} text-white px-8 py-4 rounded-xl font-medium transition-all w-full text-lg disabled:opacity-70`}
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin" />
                <span>Mengekspor Dokumen...</span>
              </>
            ) : (
              <>
                <Download className="w-6 h-6" />
                <span>Ekspor ke .DOCX (Phase 3)</span>
              </>
            )}
          </button>

          {user && (
            <button 
              onClick={saveBookToDatabase}
              disabled={isProcessing}
              className={`flex items-center justify-center space-x-3 ${t.inputBg} ${t.text} border ${t.cardBorder} hover:opacity-80 px-8 py-4 rounded-xl font-medium transition-all w-full text-lg disabled:opacity-70`}
            >
              <Save className="w-6 h-6" />
              <span>Simpan ke Database</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className={`min-h-screen ${t.bg} ${t.text} font-sans transition-colors duration-300`}>
      {/* Audio Element for TTS */}
      {audioUrl && (
        <audio ref={audioRef} src={audioUrl} onEnded={handleAudioEnded} className="hidden" />
      )}

      {/* Header */}
      <header className={`${t.cardBg} border-b ${t.cardBorder} sticky top-0 z-10 transition-colors duration-300`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => { setPhase('SETUP'); setShowLibrary(false); }}>
            <div className={`p-2 ${t.primary} text-white rounded-lg`}>
              <BookOpen className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight">AI Book Writer</h1>
          </div>
          
          <div className="flex items-center space-x-4">
            {/* Theme Selector */}
            <div className="relative group">
              <button className={`flex items-center space-x-2 px-3 py-2 rounded-lg border ${t.cardBorder} hover:opacity-80`}>
                <Palette className="w-4 h-4" />
                <span className="text-sm capitalize">{theme.replace('-', ' ')}</span>
              </button>
              <div className={`absolute right-0 mt-2 w-48 ${t.cardBg} border ${t.cardBorder} rounded-xl shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50`}>
                <div className="p-2 space-y-1">
                  {(Object.keys(THEMES) as Theme[]).map(th => (
                    <button
                      key={th}
                      onClick={() => setTheme(th)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm capitalize hover:opacity-80 ${theme === th ? t.primary + ' text-white' : ''}`}
                    >
                      {th.replace('-', ' ')}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Auth Buttons */}
            {isAuthReady && (
              user ? (
                <div className="flex items-center space-x-3">
                  <button 
                    onClick={() => setShowLibrary(!showLibrary)}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-lg border ${t.cardBorder} hover:opacity-80 text-sm font-medium`}
                  >
                    <Library className="w-4 h-4" />
                    <span>Perpustakaan</span>
                  </button>
                  <button 
                    onClick={handleLogout}
                    className="flex items-center space-x-2 px-4 py-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 text-sm font-medium"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Logout</span>
                  </button>
                </div>
              ) : (
                <button 
                  onClick={handleLogin}
                  className={`flex items-center space-x-2 px-4 py-2 rounded-lg ${t.primary} ${t.primaryHover} text-white text-sm font-medium`}
                >
                  <LogIn className="w-4 h-4" />
                  <span>Login dengan Google</span>
                </button>
              )
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {showLibrary && user ? (
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl font-bold mb-6">Perpustakaan Buku Anda</h2>
            {savedBooks.length === 0 ? (
              <div className={`${t.cardBg} border ${t.cardBorder} rounded-2xl p-12 text-center opacity-70`}>
                Belum ada buku yang disimpan.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {savedBooks.map(book => (
                  <div key={book.id} className={`${t.cardBg} border ${t.cardBorder} rounded-2xl p-6 flex flex-col`}>
                    <h3 className="font-bold text-lg mb-2">{book.title}</h3>
                    <p className="text-sm opacity-70 mb-4">{book.genre} • {book.chapters?.length || 0} Bab</p>
                    <div className="mt-auto pt-4 border-t border-current border-opacity-10">
                      <button 
                        onClick={() => {
                          setParams({
                            ...params,
                            title: book.title,
                            type: book.type,
                            genre: book.genre,
                            tone: book.tone,
                            targetAudience: book.targetAudience
                          });
                          setChapters(book.chapters || []);
                          setPhase('DONE');
                          setShowLibrary(false);
                        }}
                        className={`w-full py-2 rounded-lg ${t.primary} text-white text-sm font-medium`}
                      >
                        Buka Buku
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {phase === 'SETUP' && renderSetup()}
            {phase === 'BLUEPRINTING' && renderBlueprinting()}
            {phase === 'WRITING' && renderWriting()}
            {phase === 'DONE' && renderDone()}
          </>
        )}
      </main>
    </div>
  );
}
