import { useEffect, useRef, useState, useCallback } from 'react'
import type { AttachmentPayload } from '../types/protocol'

export interface AttachmentFile {
  id: string
  filename: string
  mime_type: string
  data: string          // base64 for uploads; "" for path references
  size_bytes: number
  path?: string         // absolute local path (no upload)
  preview_url?: string
}

export interface UseAttachmentsReturn {
  attachments: AttachmentFile[]
  addFiles: (files: File[]) => Promise<{ errors: string[] }>
  addPath: (filePath: string) => { error?: string }
  addFromDialog: (result: { path: string; filename: string; mime_type: string }) => void
  removeFile: (id: string) => void
  clearAll: () => void
  toPayloads: () => AttachmentPayload[]
}

const SINGLE_LIMIT = 5 * 1024 * 1024
const TOTAL_LIMIT = 10 * 1024 * 1024

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function guessFilename(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() || filePath
}

function guessMime(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp',
    txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
    json: 'application/json', py: 'text/x-python', js: 'text/javascript',
    ts: 'text/typescript', go: 'text/x-go',
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }
  return map[ext] || 'application/octet-stream'
}

export function useAttachments(): UseAttachmentsReturn {
  const [attachments, setAttachments] = useState<AttachmentFile[]>([])
  const counterRef = useRef(0)

  // Release object URLs when the component using this hook unmounts
  useEffect(() => {
    return () => {
      attachments.forEach(a => { if (a.preview_url) URL.revokeObjectURL(a.preview_url) })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // addFiles reads existing total via functional setState to avoid stale closure
  const addFiles = useCallback(async (files: File[]): Promise<{ errors: string[] }> => {
    const errors: string[] = []
    const newItems: AttachmentFile[] = []

    // Capture current total without closing over `attachments` state snapshot
    let existingTotal = 0
    setAttachments(prev => { existingTotal = prev.reduce((s, a) => s + a.size_bytes, 0); return prev })

    const incomingTotal = files.reduce((s, f) => s + f.size, 0)
    if (existingTotal + incomingTotal > TOTAL_LIMIT) {
      const totalMB = ((existingTotal + incomingTotal) / (1024 * 1024)).toFixed(1)
      errors.push(`附件总大小（${totalMB}MB）超过 10MB 限制`)
      return { errors }
    }

    for (const file of files) {
      if (file.size > SINGLE_LIMIT) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1)
        errors.push(`文件过大：${file.name}（${sizeMB}MB）超过 5MB 限制\n💡 可用截图工具裁剪后重试`)
        continue
      }
      try {
        const data = await fileToBase64(file)
        counterRef.current += 1
        const id = `att_${Date.now()}_${counterRef.current}`
        const preview_url = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
        newItems.push({
          id,
          filename: file.name,
          mime_type: file.type || 'application/octet-stream',
          data,
          size_bytes: file.size,
          preview_url,
        })
      } catch {
        errors.push(`无法读取文件 ${file.name}`)
      }
    }

    if (newItems.length > 0) {
      setAttachments(prev => [...prev, ...newItems])
    }
    return { errors }
  }, [])

  const addPath = useCallback((filePath: string): { error?: string } => {
    const trimmed = filePath.trim()
    if (!trimmed) return { error: '路径不能为空' }

    const filename = guessFilename(trimmed)
    const mime_type = guessMime(filename)

    counterRef.current += 1
    const id = `att_path_${Date.now()}_${counterRef.current}`

    setAttachments(prev => [...prev, {
      id,
      filename,
      mime_type,
      data: '',          // no base64 transfer
      size_bytes: 0,
      path: trimmed,
    }])
    return {}
  }, [])

  const addFromDialog = useCallback((result: { path: string; filename: string; mime_type: string }) => {
    // Result from the native OS file dialog via /api/fs/open-dialog
    // path is the full absolute path returned by the server
    counterRef.current += 1
    const id = `att_dialog_${Date.now()}_${counterRef.current}`
    setAttachments(prev => [...prev, {
      id,
      filename: result.filename,
      mime_type: result.mime_type,
      data: '',       // no upload — server will read from path
      size_bytes: 0,
      path: result.path,
    }])
  }, [])

  const removeFile = useCallback((id: string) => {
    setAttachments(prev => {
      const item = prev.find(a => a.id === id)
      if (item?.preview_url) URL.revokeObjectURL(item.preview_url)
      return prev.filter(a => a.id !== id)
    })
  }, [])

  const clearAll = useCallback(() => {
    setAttachments(prev => {
      prev.forEach(a => { if (a.preview_url) URL.revokeObjectURL(a.preview_url) })
      return []
    })
  }, [])

  const toPayloads = useCallback((): AttachmentPayload[] =>
    attachments.map(a => ({
      filename: a.filename,
      mime_type: a.mime_type,
      data: a.data,
      size_bytes: a.size_bytes,
      path: a.path,
    })), [attachments])

  return { attachments, addFiles, addPath, addFromDialog, removeFile, clearAll, toPayloads }
}
