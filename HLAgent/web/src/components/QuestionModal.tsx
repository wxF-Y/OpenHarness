import { useEffect, useId, useRef, useState } from 'react'
import type { FrontendRequest, QuestionOption } from '../types/protocol'

interface Props {
  question?: string
  options?: QuestionOption[]
  multiSelect?: boolean
  requestId: string
  sendRequest: (req: FrontendRequest) => void
  onClose: () => void
}

const OTHER_VALUE = '__other__'

export default function QuestionModal({
  question,
  options,
  multiSelect = false,
  requestId,
  sendRequest,
  onClose,
}: Props) {
  const hasOptions = options && options.length > 0
  const [selected, setSelected] = useState<string[]>([])
  const [otherText, setOtherText] = useState('')
  const [freeText, setFreeText] = useState('')
  const [previewOption, setPreviewOption] = useState<QuestionOption | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const uid = useId()

  useEffect(() => {
    if (!hasOptions) inputRef.current?.focus()
  }, [hasOptions])

  function submit() {
    let answer: string
    if (!hasOptions) {
      answer = freeText.trim()
    } else {
      const parts: string[] = []
      for (const s of selected) {
        if (s === OTHER_VALUE) {
          if (otherText.trim()) parts.push(otherText.trim())
        } else {
          parts.push(s)
        }
      }
      if (parts.length === 0) return
      answer = parts.join(', ')
    }
    sendRequest({ type: 'question_response', request_id: requestId, answer })
    onClose()
  }

  function cancel() {
    sendRequest({ type: 'question_response', request_id: requestId, answer: '' })
    onClose()
  }

  function toggleOption(label: string) {
    if (multiSelect) {
      setSelected(prev =>
        prev.includes(label) ? prev.filter(s => s !== label) : [...prev, label]
      )
    } else {
      setSelected([label])
    }
  }

  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (e.key === 'Escape') cancel()
      if (e.key === 'Enter' && !e.shiftKey) {
        if (!hasOptions) { submit(); return }
        if (selected.length > 0) { submit() }
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, otherText, freeText, hasOptions])

  const showPreview = previewOption?.preview != null
  const isOtherSelected = selected.includes(OTHER_VALUE)

  const isSubmitDisabled = hasOptions
    ? selected.length === 0 || (isOtherSelected && selected.every(s => s === OTHER_VALUE) && !otherText.trim())
    : freeText.trim().length === 0

  return (
    <div
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) cancel() }}
    >
      <div style={{
        backgroundColor: '#1e1e2e', border: '1px solid #313244', borderRadius: '10px',
        width: showPreview ? '760px' : '480px', maxWidth: '95vw',
        maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{
          padding: '1rem 1.25rem 0.75rem',
          borderBottom: '1px solid #313244',
          fontSize: '0.9rem', fontWeight: 600, color: '#cdd6f4',
        }}>
          {question || '请回答'}
        </div>

        {/* Body */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

          {/* Options list */}
          {hasOptions && (
            <div style={{
              flex: 1, overflowY: 'auto',
              padding: '0.5rem 0',
              borderRight: showPreview ? '1px solid #313244' : 'none',
            }}>
              {options.map((opt, i) => {
                const isSelected = selected.includes(opt.label)
                const optId = `${uid}-opt-${i}`
                return (
                  <label
                    key={opt.label}
                    htmlFor={optId}
                    onMouseEnter={() => setPreviewOption(opt)}
                    onMouseLeave={() => setPreviewOption(null)}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                      padding: '0.6rem 1.25rem',
                      cursor: 'pointer',
                      backgroundColor: isSelected ? 'rgba(137,180,250,0.08)' : 'transparent',
                      transition: 'background 0.1s',
                    }}
                  >
                    <input
                      id={optId}
                      type={multiSelect ? 'checkbox' : 'radio'}
                      name={`question-${uid}`}
                      checked={isSelected}
                      onChange={() => toggleOption(opt.label)}
                      style={{ marginTop: '0.2rem', accentColor: '#89b4fa', flexShrink: 0 }}
                    />
                    <div>
                      <div style={{ fontSize: '0.875rem', color: '#cdd6f4', fontWeight: isSelected ? 600 : 400 }}>
                        {opt.label}
                      </div>
                      {opt.description && (
                        <div style={{ fontSize: '0.78rem', color: '#6c7086', marginTop: '0.15rem' }}>
                          {opt.description}
                        </div>
                      )}
                    </div>
                  </label>
                )
              })}

              {/* Other option */}
              <label
                htmlFor={`${uid}-other`}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                  padding: '0.6rem 1.25rem',
                  cursor: 'pointer',
                  backgroundColor: isOtherSelected ? 'rgba(137,180,250,0.08)' : 'transparent',
                }}
              >
                <input
                  id={`${uid}-other`}
                  type={multiSelect ? 'checkbox' : 'radio'}
                  name={`question-${uid}`}
                  checked={isOtherSelected}
                  onChange={() => toggleOption(OTHER_VALUE)}
                  style={{ marginTop: '0.2rem', accentColor: '#89b4fa', flexShrink: 0 }}
                />
                <div style={{ fontSize: '0.875rem', color: '#6c7086', fontWeight: isOtherSelected ? 600 : 400 }}>
                  其他
                </div>
              </label>
            </div>
          )}

          {/* Preview panel */}
          {showPreview && previewOption?.preview && (
            <div style={{ width: '340px', flexShrink: 0, overflowY: 'auto', padding: '0.75rem 1rem' }}>
              <pre style={{
                margin: 0, fontSize: '0.78rem', color: '#a6adc8',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                fontFamily: 'monospace', lineHeight: 1.6,
              }}>
                {previewOption.preview}
              </pre>
            </div>
          )}
        </div>

        {/* Bottom input */}
        <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid #313244' }}>
          {/* Free-text input when "Other" is selected or no options */}
          {(!hasOptions || isOtherSelected) && (
            <input
              ref={inputRef}
              type="text"
              value={hasOptions ? otherText : freeText}
              onChange={(e) => hasOptions ? setOtherText(e.target.value) : setFreeText(e.target.value)}
              placeholder={hasOptions ? '请输入自定义回答…' : '提交答案'}
              autoFocus={isOtherSelected}
              style={{
                width: '100%', backgroundColor: '#11111b',
                border: '1px solid #313244', borderRadius: '6px',
                padding: '0.5rem 0.75rem', color: '#cdd6f4',
                fontSize: '0.875rem', outline: 'none',
                boxSizing: 'border-box', marginBottom: '0.5rem',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = '#89b4fa' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = '#313244' }}
            />
          )}
          {hasOptions && !isOtherSelected && (
            <div style={{
              height: '36px', display: 'flex', alignItems: 'center',
              fontSize: '0.8rem', color: '#45475a',
            }}>
              {selected.length === 0 ? '选择一个选项…' : ''}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.72rem', color: '#45475a' }}>按 Esc 取消</span>
            <button
              onClick={submit}
              disabled={isSubmitDisabled}
              style={{
                backgroundColor: '#89b4fa', color: '#1e1e2e',
                border: 'none', borderRadius: '6px',
                padding: '0.4rem 1rem', cursor: 'pointer',
                fontSize: '0.875rem', fontWeight: 600,
                opacity: isSubmitDisabled ? 0.4 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              提交答案
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
