const MAX_PDF_TEXT_LENGTH = 20000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfJsLib = any;

let pdfjsLibPromise: Promise<PdfJsLib> | null = null;

const resolveWorkerSrc = async (pdfjs: PdfJsLib) => {
  if (typeof window === 'undefined') return;
  if (!pdfjs.GlobalWorkerOptions) return;
  if (pdfjs.GlobalWorkerOptions.workerSrc) return;

  try {
    const workerModule = await import('pdfjs-dist/legacy/build/pdf.worker.min?url');
    pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
  } catch (error) {
    console.warn('Falling back to CDN worker for pdf.js', error);
    const version = pdfjs.version ?? '4.8.69';
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${version}/pdf.worker.min.js`;
  }
};

const getPdfJsLib = async (): Promise<PdfJsLib> => {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = (async () => {
      const mod = await import('pdfjs-dist/legacy/build/pdf');
      const pdfjs = (mod as any)?.default ?? mod;
      await resolveWorkerSrc(pdfjs);
      return pdfjs;
    })();
  } else if (typeof window !== 'undefined') {
    // Ensure worker configured when switching from SSR to CSR.
    pdfjsLibPromise.then(resolveWorkerSrc).catch(() => {});
  }
  return pdfjsLibPromise;
};

export const extractTextFromPdf = async (file: File): Promise<string> => {
  try {
    const data = await file.arrayBuffer();
    const pdfjsLib = await getPdfJsLib();

    const disableWorker =
      typeof window === 'undefined' ||
      !pdfjsLib.GlobalWorkerOptions ||
      !pdfjsLib.GlobalWorkerOptions.workerSrc;

    const pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(data),
      disableWorker
    }).promise;

    const chunks: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();

      const pageText = textContent.items
        .map((item: any) => (item.str || ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (pageText) {
        chunks.push(pageText);
      }
    }

    const fullText = chunks.join('\n\n');
    if (fullText.length > MAX_PDF_TEXT_LENGTH) {
      return `${fullText.slice(0, MAX_PDF_TEXT_LENGTH)}\n\n[Truncated after ${MAX_PDF_TEXT_LENGTH} characters]`;
    }
    return fullText;
  } catch (error) {
    console.error('Failed to extract PDF text:', error);
    return '';
  }
};
