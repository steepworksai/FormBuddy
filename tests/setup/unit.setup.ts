import '@testing-library/jest-dom/vitest'
import { createHash } from 'node:crypto'

if (typeof Blob !== 'undefined' && !('arrayBuffer' in Blob.prototype)) {
  Object.defineProperty(Blob.prototype, 'arrayBuffer', {
    value: function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(reader.error)
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.readAsArrayBuffer(this)
      })
    },
  })
}

if (typeof File !== 'undefined' && !('arrayBuffer' in File.prototype) && 'arrayBuffer' in Blob.prototype) {
  Object.defineProperty(File.prototype, 'arrayBuffer', {
    value: async function arrayBuffer(this: File): Promise<ArrayBuffer> {
      return Blob.prototype.arrayBuffer.call(this)
    },
  })
}

if (typeof File !== 'undefined' && !('text' in File.prototype)) {
  Object.defineProperty(File.prototype, 'text', {
    value: function text(this: File): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(reader.error)
        reader.onload = () => resolve(String(reader.result ?? ''))
        reader.readAsText(this)
      })
    },
  })
}

if (typeof crypto !== 'undefined' && crypto.subtle) {
  const originalDigest = crypto.subtle.digest.bind(crypto.subtle)
  Object.defineProperty(crypto.subtle, 'digest', {
    value: async (algorithm: string | AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> => {
      try {
        return await originalDigest(algorithm, data)
      } catch {
        const algo = typeof algorithm === 'string' ? algorithm.toLowerCase() : 'sha-256'
        const hashName = algo.includes('256') ? 'sha256' : 'sha256'
        const buffer =
          data instanceof ArrayBuffer
            ? Buffer.from(new Uint8Array(data))
            : ArrayBuffer.isView(data)
              ? Buffer.from(data.buffer as ArrayBuffer)
              : Buffer.from([])
        const digest = createHash(hashName).update(buffer).digest()
        return digest.buffer.slice(digest.byteOffset, digest.byteOffset + digest.byteLength)
      }
    },
  })
}
