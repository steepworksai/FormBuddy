export async function requestFolderAccess(): Promise<FileSystemDirectoryHandle> {
  return await window.showDirectoryPicker({ mode: 'readwrite' })
}

import { isSupported } from '../config/supportedTypes'

export async function listFiles(
  dirHandle: FileSystemDirectoryHandle
): Promise<File[]> {
  const files: File[] = []
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file' && isSupported(entry.name)) {
      const file = await (entry as FileSystemFileHandle).getFile()
      files.push(file)
    }
  }
  return files
}

export async function writeFileToFolder(
  dirHandle: FileSystemDirectoryHandle,
  fileName: string,
  content: Blob | ArrayBuffer | string
): Promise<void> {
  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(content)
  await writable.close()
}
