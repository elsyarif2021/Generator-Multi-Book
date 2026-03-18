export type BookType = 'FICTION' | 'NON_FICTION' | 'STORY_BOOK';

export interface BookParams {
  title: string;
  type: BookType;
  genre: string;
  tone: string;
  targetAudience: string;
  chapterCount: number;
  wordsPerChapter: number;
  referenceCount: number; // Only for Non-Fiction
}

export interface ChapterOutline {
  chapterNumber: number;
  title: string;
  description: string;
}

export interface ChapterContent {
  chapterNumber: number;
  title: string;
  content: string;
  imageUrl?: string;
}
