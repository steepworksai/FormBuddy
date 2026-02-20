import * as pdfjsLib from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'

import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export const MAX_PDF_PAGES = 25

// If a page has fewer than this many characters it is treated as scanned
const MIN_PAGE_TEXT_CHARS = 30

// Thrown immediately when page count exceeds the limit
export class PDFTooLargeError extends Error {
  constructor(public readonly pageCount: number) {
    super(`PDF has ${pageCount} pages — max ${MAX_PDF_PAGES} allowed`)
    this.name = 'PDFTooLargeError'
  }
}

export interface RawPDFPage {
  page: number
  rawText: string
  /** Present when the page had no embedded text and needs OCR */
  canvas?: HTMLCanvasElement
}

/** Renders a PDF page at 2× scale for sharper OCR results */
async function renderPageToCanvas(
  page: pdfjsLib.PDFPageProxy
): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale: 2 })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport, canvas }).promise
  return canvas
}

/**
 * Extracts text from a PDF file, one page at a time.
 *
 * - Throws PDFTooLargeError immediately if the PDF exceeds MAX_PDF_PAGES.
 * - For pages with enough embedded text the rawText is returned directly.
 * - For sparse / scanned pages a rendered canvas is attached so the caller
 *   can run OCR on just those pages (mixed-document support).
 */
export async function extractTextFromPDF(
  file: File
): Promise<{ pages: RawPDFPage[]; pageCount: number }> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  if (pdf.numPages > MAX_PDF_PAGES) {
    throw new PDFTooLargeError(pdf.numPages)
  }

  const pages: RawPDFPage[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const rawText = content.items
      .filter((item): item is TextItem => 'str' in item)
      .map(item => item.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (rawText.length < MIN_PAGE_TEXT_CHARS) {
      // Scanned page — render so the indexer can OCR it
      const canvas = await renderPageToCanvas(page)
      pages.push({ page: i, rawText: '', canvas })
    } else {
      pages.push({ page: i, rawText })
    }
  }

  return { pages, pageCount: pdf.numPages }
}
