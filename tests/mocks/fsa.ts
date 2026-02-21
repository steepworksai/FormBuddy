type FileContent = string

class MemoryFile {
  constructor(private readonly store: Map<string, FileContent>, private readonly path: string) {}
  async text(): Promise<string> {
    return this.store.get(this.path) ?? ''
  }
}

class MemoryWritable {
  private buffer = ''

  constructor(private readonly store: Map<string, FileContent>, private readonly path: string) {}

  async write(data: unknown): Promise<void> {
    if (typeof data === 'string') {
      this.buffer = data
      return
    }
    if (data instanceof Blob) {
      this.buffer = await data.text()
      return
    }
    if (data instanceof ArrayBuffer) {
      this.buffer = new TextDecoder().decode(data)
      return
    }
    throw new Error('Unsupported write type in MemoryWritable')
  }

  async close(): Promise<void> {
    this.store.set(this.path, this.buffer)
  }
}

class MemoryFileHandle {
  constructor(private readonly store: Map<string, FileContent>, private readonly path: string) {}

  async getFile(): Promise<{ text: () => Promise<string> }> {
    const file = new MemoryFile(this.store, this.path)
    return {
      text: () => file.text(),
    }
  }

  async createWritable(): Promise<{ write: (data: unknown) => Promise<void>; close: () => Promise<void> }> {
    const writable = new MemoryWritable(this.store, this.path)
    return {
      write: (data: unknown) => writable.write(data),
      close: () => writable.close(),
    }
  }
}

class MemoryDirectoryHandle {
  constructor(
    private readonly store: Map<string, FileContent>,
    private readonly root: string
  ) {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryDirectoryHandle> {
    const nextPath = `${this.root}/${name}`
    if (!options?.create && ![...this.store.keys()].some(key => key.startsWith(nextPath + '/'))) {
      throw new Error(`Directory not found: ${name}`)
    }
    return new MemoryDirectoryHandle(this.store, nextPath)
  }

  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    const prefix = `${this.root}/${name}`
    for (const key of [...this.store.keys()]) {
      if (key === prefix || (options?.recursive && key.startsWith(prefix + '/'))) {
        this.store.delete(key)
      }
    }
  }

  async getFileHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<{ getFile: () => Promise<{ text: () => Promise<string> }>; createWritable: () => Promise<{ write: (data: unknown) => Promise<void>; close: () => Promise<void> }> }> {
    const path = `${this.root}/${name}`
    if (!options?.create && !this.store.has(path)) throw new Error(`File not found: ${name}`)
    if (options?.create && !this.store.has(path)) this.store.set(path, '')
    const fileHandle = new MemoryFileHandle(this.store, path)
    return {
      getFile: () => fileHandle.getFile(),
      createWritable: () => fileHandle.createWritable(),
    }
  }
}

export function createMemoryDirHandle(): FileSystemDirectoryHandle {
  const store = new Map<string, FileContent>()
  const rootDir = new MemoryDirectoryHandle(store, '/root')
  return rootDir as unknown as FileSystemDirectoryHandle
}

/**
 * Like createMemoryDirHandle but also exposes the underlying store so tests
 * can inspect or delete individual files (e.g. to simulate missing uuid.json).
 */
export function createMemoryDirHandleWithStore(): {
  handle: FileSystemDirectoryHandle
  store: Map<string, FileContent>
} {
  const store = new Map<string, FileContent>()
  const rootDir = new MemoryDirectoryHandle(store, '/root')
  return { handle: rootDir as unknown as FileSystemDirectoryHandle, store }
}
