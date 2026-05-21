import { useEffect, useRef, useState } from 'react'
import type { FrontendRequest } from '../types/protocol'

interface Props {
  question?: string
  requestId: string
  sendRequest: (req: FrontendRequest) => void
  onClose: () => void
}

export default function QuestionModal({ question, requestId, sendRequest, onClose }: Props) {
  const [answer, setAnswer] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  function confirm() {
    sendRequest({ type: 'question_response', request_id: requestId, answer })
    onClose()
  }

  function cancel() {
    // Send empty answer so the backend future is resolved and the session
    // is not left frozen waiting for a response that will never come.
    sendRequest({ type: 'question_response', request_id: requestId, answer: '' })
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ backgroundColor: '#181825', border: '1px solid #313244', borderRadius: '8px', padding: '1.5rem', maxWidth: '480px', width: '90%' }}>
        <div style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem', color: '#89b4fa', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          💬 请回答
        </div>

        {question && (
          <div style={{ fontSize: '0.9rem', color: '#cdd6f4', marginBottom: '1rem' }}>{question}</div>
        )}

        <input
          ref={inputRef}
          type="text"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') cancel() }}
          style={{ width: '100%', backgroundColor: '#11111b', border: '1px solid #313244', borderRadius: '6px', padding: '0.5rem 0.75rem', color: '#cdd6f4', fontSize: '0.875rem', outline: 'none', boxSizing: 'border-box' }}
          placeholder="输入回答…"
        />

        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button onClick={cancel} style={{ backgroundColor: '#313244', color: '#cdd6f4', border: 'none', borderRadius: '6px', padding: '0.5rem 1rem', cursor: 'pointer' }}>取消</button>
          <button onClick={confirm} style={{ backgroundColor: '#89b4fa', color: '#1e1e2e', border: 'none', borderRadius: '6px', padding: '0.5rem 1rem', cursor: 'pointer', fontWeight: 600 }}>确认</button>
        </div>
      </div>
    </div>
  )
}
