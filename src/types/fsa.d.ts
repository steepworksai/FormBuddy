// File System Access API type declarations
// (not yet in all TypeScript DOM lib targets)

interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemHandle>
  keys(): AsyncIterableIterator<string>
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>
  [Symbol.asyncIterator](): AsyncIterableIterator<FileSystemHandle>
  queryPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission(options?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
}

interface Window {
  showDirectoryPicker(options?: {
    id?: string
    mode?: 'read' | 'readwrite'
    startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'
  }): Promise<FileSystemDirectoryHandle>
  showOpenFilePicker(options?: object): Promise<FileSystemFileHandle[]>
  showSaveFilePicker(options?: object): Promise<FileSystemFileHandle>
}
