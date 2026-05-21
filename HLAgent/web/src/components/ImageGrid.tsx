import { useEffect, useRef, useState } from 'react'
import type { MediaItem } from '../types/protocol'
import ImageLightbox from './ImageLightbox'

const SHIMMER_STYLE = `@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}`

interface Props {
  media: MediaItem[]
  sessionId?: string
}

function LazyImage({ item, sessionId, onClick }: { item: MediaItem; sessionId?: string; onClick: () => void }) {
  const [src, setSrc] = useState<string>('')
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (item.data) {
      setSrc(`data:${item.media_type};base64,${item.data}`)
    } else if (item.source_path && sessionId) {
      setSrc(`/api/sessions/${sessionId}/files?path=${encodeURIComponent(item.source_path)}`)
    }
  }, [item, sessionId])

  return (
    <div ref={ref} onClick={onClick} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onClick()} style={{ position: 'relative', maxWidth: 220, maxHeight: 160, minWidth: 60, minHeight: 60, borderRadius: 6, border: '1px solid #313244', overflow: 'hidden', cursor: 'pointer', flexShrink: 0 }}>
      {!loaded && !error && (
        <div style={{ width: 160, height: 120, background: 'linear-gradient(90deg,#313244 25%,#45475a 50%,#313244 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite', borderRadius: 6 }} />
      )}
      {error && (
        <div style={{ width: 160, height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 4, color: '#6c7086', fontSize: '0.75rem' }}>
          <span>🖼️</span><span>[无法加载图片]</span>
        </div>
      )}
      {src && !error && (
        <img
          src={src}
          alt={item.filename || ''}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          style={{ maxWidth: 220, maxHeight: 160, objectFit: 'cover', display: loaded ? 'block' : 'none', transition: 'opacity 150ms' }}
        />
      )}
    </div>
  )
}

export default function ImageGrid({ media, sessionId }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)

  const display = expanded ? media : media.slice(0, 3)
  const overflow = media.length - 3

  return (
    <>
      <style>{SHIMMER_STYLE}</style>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 12px 4px', alignItems: 'flex-start' }}>
        {display.map((item, i) => (
          <LazyImage key={item.source_path || item.data?.slice(0, 16) || i} item={item} sessionId={sessionId} onClick={() => setLightboxIdx(i)} />
        ))}
        {!expanded && overflow > 0 && (
          <button
            onClick={() => setExpanded(true)}
            style={{ width: 80, height: 80, borderRadius: 6, background: 'rgba(17,17,27,0.7)', border: '1px solid #313244', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#cdd6f4', fontWeight: 700, fontSize: '1.25rem', flexShrink: 0 }}
            aria-label={`显示全部 ${media.length} 张图片`}
          >+{overflow}</button>
        )}
        {expanded && (
          <button onClick={() => setExpanded(false)} style={{ background: 'none', border: 'none', color: '#89b4fa', fontSize: '0.75rem', cursor: 'pointer', alignSelf: 'flex-end' }}>▲ 收起</button>
        )}
      </div>
      {lightboxIdx !== null && (
        <ImageLightbox images={media} initialIndex={lightboxIdx} onClose={() => setLightboxIdx(null)} sessionId={sessionId} />
      )}
    </>
  )
}
