import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ImageRun } from 'docx';
import { saveAs } from 'file-saver';
import { ChapterContent } from '../types';

export async function exportToDocx(title: string, chapters: ChapterContent[]) {
  const docChapters = chapters.map((chapter) => {
    const paragraphs = chapter.content.split('\n\n').map(text => {
      // Clean up basic markdown bold/italic for plain text (simplified)
      const cleanText = text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').replace(/#(.*?)\n/g, '$1\n');
      
      return new Paragraph({
        children: [
          new TextRun({
            text: cleanText,
            font: "Times New Roman",
            size: 24, // 12pt (half-points)
          }),
        ],
        spacing: {
          line: 360, // 1.5 spacing (240 * 1.5)
        },
        alignment: AlignmentType.JUSTIFIED,
      });
    });

    const chapterElements: any[] = [
      new Paragraph({
        text: `Bab ${chapter.chapterNumber}: ${chapter.title}`,
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: {
          after: 400,
        },
      })
    ];

    if (chapter.imageUrl) {
      try {
        const base64Data = chapter.imageUrl.split(',')[1];
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);

        chapterElements.push(
          new Paragraph({
            children: [
              new ImageRun({
                data: byteArray,
                transformation: {
                  width: 400,
                  height: 400,
                },
                type: 'png',
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: {
              after: 400,
            },
          })
        );
      } catch (e) {
        console.error("Failed to embed image in docx", e);
      }
    }

    chapterElements.push(...paragraphs);
    chapterElements.push(
      new Paragraph({
        text: "",
        pageBreakBefore: true, // Page break after each chapter
      })
    );

    return chapterElements;
  }).flat();

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: title,
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            spacing: {
              after: 800,
            },
          }),
          new Paragraph({
            text: "",
            pageBreakBefore: true,
          }),
          ...docChapters,
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.docx`);
}
