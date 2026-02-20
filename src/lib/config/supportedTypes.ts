// Supported file types for FormBuddy indexing.
// To add a new type: add an entry here — everything else picks it up automatically.

export interface SupportedType {
  extensions: string[]   // lowercase, no dot
  label: string          // human-readable category
  icon: string           // emoji shown in the file list
  mimeTypes?: string[]   // optional — used for drag-drop validation
}

export const SUPPORTED_TYPES: SupportedType[] = [
  {
    extensions: ['pdf'],
    label: 'PDF',
    icon: '📄',
    mimeTypes: ['application/pdf'],
  },
  {
    extensions: ['png', 'jpg', 'jpeg', 'webp'],
    label: 'Image',
    icon: '🖼️',
    mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
  },
  {
    extensions: ['txt'],
    label: 'Text Note',
    icon: '📝',
    mimeTypes: ['text/plain'],
  },
]

// Flat set of all supported extensions — for fast lookup
export const SUPPORTED_EXTENSIONS: Set<string> = new Set(
  SUPPORTED_TYPES.flatMap(t => t.extensions)
)

// Returns the SupportedType entry for a filename, or null if unsupported
export function getTypeInfo(fileName: string): SupportedType | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  return SUPPORTED_TYPES.find(t => t.extensions.includes(ext)) ?? null
}

export function isSupported(fileName: string): boolean {
  return getTypeInfo(fileName) !== null
}
