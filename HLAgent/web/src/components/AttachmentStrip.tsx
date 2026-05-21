import type { AttachmentFile } from '../hooks/useAttachments'

const CHIP_COLORS: Record<string, string> = {
  'application/pdf': '#f38ba8',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '#89b4fa',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '#a6e3a1',
  'text/csv': '#f9e2af',
  'application/json': '#cba6f7',
}

function getChipColor(mimeType: string): string {
  return CHIP_COLORS[mimeType] ?? (mimeType.startsWith('text/') ? '#94e2d5' : '#585b70')
}

function getTypeLabel(mimeType: string): string {
  if (mimeType === 'application/pdf') return 'PDF'
  if (mimeType.includes('word')) return 'DOC'
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return 'XLS'
  if (mimeType === 'text/csv') return 'CSV'
  if (mimeType === 'application/json') return 'JSON'
  if (mimeType.startsWith('text/')) return 'TXT'
  return 'FILE'
}

function ImageChip({ att, onRemove, disabled }: { att: AttachmentFile; onRemove: () => void; disabled?: boolean }) {
  return (
    <div style={{ position: 'relative', width: 64, height: 64, flexShrink: 0 }}>
      <img
        src={att.preview_url}
        alt={att.filename}
        title={att.filename}
        style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, border: '2px solid #313244', display: 'block' }}
      />
      {!disabled && (
        <button
          onClick={onRemove}
          title="移除"
          style={{
            position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: '50%',
            background: 'rgba(17,17,27,0.8)', color: '#a6adc8', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', padding: 0,
          }}
        >×</button>
      )}
    </div>
  )
}

function DocumentChip({ att, onRemove, disabled }: { att: AttachmentFile; onRemove: () => void; disabled?: boolean }) {
  const color = getChipColor(att.mime_type)
  const label = getTypeLabel(att.mime_type)
  const name = att.filename.length > 18 ? att.filename.slice(0, 17) + '…' : att.filename
  const sizeMB = att.size_bytes > 1024 * 1024
    ? `${(att.size_bytes / (1024 * 1024)).toFixed(1)}MB`
    : `${Math.round(att.size_bytes / 1024)}KB`

  return (
    <div style={{
      minWidth: 160, maxWidth: 200, height: 44, borderRadius: 6, background: '#11111b',
      border: '1px solid #313244', display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px',
      position: 'relative', flexShrink: 0,
    }}>
      <div style={{
        width: 28, height: 20, borderRadius: 3, background: color, color: '#1e1e2e',
        fontSize: '0.6rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>{label}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.75rem', color: '#cdd6f4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
        <div style={{ fontSize: '0.65rem', color: '#6c7086' }}>将提取文字内容 · {sizeMB}</div>
      </div>
      {!disabled && (
        <button
          onClick={onRemove}
          style={{ background: 'none', border: 'none', color: '#585b70', cursor: 'pointer', padding: 0, fontSize: '0.85rem', lineHeight: 1 }}
        >×</button>
      )}
    </div>
  )
}

interface AttachmentStripProps {
  attachments: AttachmentFile[]
  onRemove: (id: string) => void
  disabled?: boolean
}

export default function AttachmentStrip({ attachments, onRemove, disabled }: AttachmentStripProps) {
  const visible = attachments.length > 0

  return (
    <div style={{
      overflow: 'hidden',
      maxHeight: visible ? 88 : 0,
      transition: 'max-height 200ms ease',
      background: '#11111b',
      borderBottom: visible ? '1px solid #313244' : 'none',
    }}>
      <div style={{
        display: 'flex', gap: 8, padding: '8px 12px', overflowX: 'auto', alignItems: 'center',
      }}>
        {attachments.map(att =>
          att.mime_type.startsWith('image/') ? (
            <ImageChip key={att.id} att={att} onRemove={() => onRemove(att.id)} disabled={disabled} />
          ) : (
            <DocumentChip key={att.id} att={att} onRemove={() => onRemove(att.id)} disabled={disabled} />
          )
        )}
      </div>
    </div>
  )
}
