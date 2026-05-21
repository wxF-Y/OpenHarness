import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MediaItem } from '../types/protocol'
import { useToast } from './Toast'

interface Props {
  images: MediaItem[]
  initialIndex?: number
  onClose: () => void
  sessionId?: string
}

export default function ImageLightbox({ images, initialIndex = 0, onClose, sessionId }: Props) {
  const [idx, setIdx] = useState(initialIndex)
  const [copying, setCopying] = useState(false)
  const toast = useToast()

  const item = images[idx]

  const [resolvedSrc, setResolvedSrc] = useState<string>('')

  useEffect(() => {
    if (!item) return
    if (item.data) {
      setResolvedSrc(`data:${item.media_type};base64,${item.data}`)
    } else if (item.source_path && sessionId) {
      setResolvedSrc(`/api/sessions/${sessionId}/files?path=${encodeURIComponent(item.source_path)}`)
    } else {
      setResolvedSrc('')
    }
  }, [item, sessionId])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') setIdx(i => Math.max(0, i - 1))
      if (e.key === 'ArrowRight') setIdx(i => Math.min(images.length - 1, i + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [images.length, onClose])

  async function handleCopy() {
    if (!resolvedSrc) return
    try {
      setCopying(true)
      const resp = await fetch(resolvedSrc)
      const blob = await resp.blob()
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
      toast.show('已复制图片', 'success', 1500)
    } catch {
      toast.show('复制失败，请手动下载', 'error', 3000)
    } finally {
      setCopying(false)
    }
  }

  function handleDownload() {
    if (!resolvedSrc) return
    const a = document.createElement('a')
    a.href = resolvedSrc
    a.download = item?.filename || 'image.png'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const filename = item?.filename || item?.source_path?.split('/').pop() || ''

  return createPortal(
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(17,17,27,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'fadeIn 180ms ease' }}
    >
      <style>{`@keyframes fadeIn{from{opacity:0}to{opacity:1}}`}</style>

      {/* Prev / Next */}
      {images.length > 1 && idx > 0 && (
        <button onClick={(e) => { e.stopPropagation(); setIdx(i => i - 1) }}
          style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#a6adc8', fontSize: '1.5rem', cursor: 'pointer', padding: '8px 12px', borderRadius: 6 }}>◀</button>
      )}
      {images.length > 1 && idx < images.length - 1 && (
        <button onClick={(e) => { e.stopPropagation(); setIdx(i => i + 1) }}
          style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#a6adc8', fontSize: '1.5rem', cursor: 'pointer', padding: '8px 12px', borderRadius: 6 }}>▶</button>
      )}

      {/* Close */}
      <button onClick={onClose}
        style={{ position: 'absolute', top: 16, right: 16, width: 32, height: 32, borderRadius: 6, background: '#313244', border: 'none', color: '#cdd6f4', cursor: 'pointer', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>

      {/* Image */}
      {resolvedSrc && (
        <img
          src={resolvedSrc}
          alt={filename}
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 8, boxShadow: '0 8px 40px rgba(0,0,0,0.7)', objectFit: 'contain', userSelect: 'none' }}
        />
      )}

      {/* Bottom bar */}
      <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '0.8rem', color: '#a6adc8' }}>{filename}</span>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={handleCopy} style={{ background: 'none', border: 'none', color: '#89b4fa', fontSize: '0.8125rem', cursor: 'pointer' }}>
            {copying ? '✓ 已复制' : '📋 复制'}
          </button>
          <button onClick={handleDownload} style={{ background: 'none', border: 'none', color: '#89b4fa', fontSize: '0.8125rem', cursor: 'pointer' }}>↓ 下载</button>
        </div>
      </div>

      {/* Dots pagination */}
      {images.length > 1 && (
        <div style={{ position: 'absolute', bottom: 48, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 6 }}>
          {images.map((_, i) => (
            <div key={i} onClick={(e) => { e.stopPropagation(); setIdx(i) }}
              style={{ width: 8, height: 8, borderRadius: '50%', background: i === idx ? '#89b4fa' : '#45475a', cursor: 'pointer' }} />
          ))}
        </div>
      )}
    </div>,
    document.body
  )
}
