import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface Props {
  content: string
  compact?: boolean
}

export default function MDRenderer({ content, compact = false }: Props) {
  return (
    <div style={{ fontSize: compact ? '0.8125rem' : '0.875rem', lineHeight: 1.6, color: '#cdd6f4' }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            const inline = !match
            if (inline) {
              return (
                <code
                  style={{ backgroundColor: '#313244', padding: '0.1em 0.3em', borderRadius: '3px', fontSize: '0.85em', fontFamily: 'monospace', color: '#cba6f7' }}
                  {...props}
                >
                  {children}
                </code>
              )
            }
            return (
              <SyntaxHighlighter
                style={oneDark}
                language={match[1]}
                PreTag="div"
                customStyle={{ borderRadius: '6px', fontSize: '0.8125rem', margin: '0.5rem 0' }}
              >
                {String(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
            )
          },
          p({ children }) {
            return <p style={{ margin: '0.25rem 0' }}>{children}</p>
          },
          ul({ children }) {
            return <ul style={{ paddingLeft: '1.25rem', margin: '0.25rem 0' }}>{children}</ul>
          },
          ol({ children }) {
            return <ol style={{ paddingLeft: '1.25rem', margin: '0.25rem 0' }}>{children}</ol>
          },
          li({ children }) {
            return <li style={{ margin: '0.1rem 0' }}>{children}</li>
          },
          h1({ children }) { return <h1 style={{ fontSize: '1.25rem', color: '#89b4fa', margin: '0.5rem 0 0.25rem', fontWeight: 700 }}>{children}</h1> },
          h2({ children }) { return <h2 style={{ fontSize: '1.1rem', color: '#89b4fa', margin: '0.5rem 0 0.25rem', fontWeight: 600 }}>{children}</h2> },
          h3({ children }) { return <h3 style={{ fontSize: '1rem', color: '#89b4fa', margin: '0.4rem 0 0.2rem', fontWeight: 600 }}>{children}</h3> },
          blockquote({ children }) {
            return <blockquote style={{ borderLeft: '3px solid #45475a', paddingLeft: '0.75rem', color: '#a6adc8', margin: '0.25rem 0' }}>{children}</blockquote>
          },
          a({ href, children }) {
            return <a href={href} style={{ color: '#89b4fa', textDecoration: 'underline' }} target="_blank" rel="noopener noreferrer">{children}</a>
          },
          input({ type, checked }) {
            if (type === 'checkbox') {
              return (
                <input
                  type="checkbox"
                  checked={checked}
                  readOnly
                  style={{ accentColor: '#a6e3a1', marginRight: '0.3rem' }}
                />
              )
            }
            return <input type={type} />
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
