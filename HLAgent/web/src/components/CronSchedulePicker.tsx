import { useState, useEffect, useRef } from 'react'
import {
  type SchedulerState,
  type FrequencyMode,
  parseCronToSchedulerState,
  schedulerStateToCron,
  isValidCronExpression,
  cronToHumanReadable,
} from '../utils/cronUtils'

interface Props {
  value: string
  onChange: (cron: string) => void
  onValidChange?: (isValid: boolean) => void
}

const MODES: { label: string; value: FrequencyMode }[] = [
  { label: '每天',  value: 'daily' },
  { label: '工作日', value: 'workday' },
  { label: '每周',  value: 'weekly' },
  { label: '每月',  value: 'monthly' },
]

// UI order: Mon→Sun, with Sun stored as 0
const WEEKDAYS = [
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 },
  { label: '周日', value: 0 },
]

const MINUTES = Array.from({ length: 60 }, (_, i) => i)  // 0-59

// Catppuccin Mocha palette
const blue = '#89b4fa'
const blueDim = '#1e3a5f'
const border = '#313244'
const muted = '#6c7086'
const subtext = '#a6adc8'
const surface = '#11111b'
const text = '#cdd6f4'
const red = '#f38ba8'

const selectStyle: React.CSSProperties = {
  backgroundColor: surface,
  border: `1px solid ${border}`,
  borderRadius: '6px',
  padding: '0.35rem 0.5rem',
  color: text,
  fontSize: '0.8125rem',
  cursor: 'pointer',
}

export default function CronSchedulePicker({ value, onChange, onValidChange }: Props) {
  // D13: initialise once, sync only when value prop actually changes
  const [state, setState] = useState<SchedulerState>(() => parseCronToSchedulerState(value))
  const [nextRun, setNextRun] = useState<string | null>(null)
  const prevValueRef = useRef(value)
  // Use a ref for onValidChange so callers can pass unstable arrow functions safely
  const onValidChangeRef = useRef(onValidChange)
  useEffect(() => { onValidChangeRef.current = onValidChange })

  useEffect(() => {
    if (value !== prevValueRef.current) {
      prevValueRef.current = value
      setState(parseCronToSchedulerState(value))
    }
  }, [value])

  // Derived: the cron string from structured state (or rawExpr in advanced mode)
  const currentCron = state.showAdvanced ? state.rawExpr : schedulerStateToCron(state)
  const advancedInvalid = state.showAdvanced && !isValidCronExpression(state.rawExpr)

  // Notify parent of validity whenever it changes (via ref, caller ref stability not required)
  useEffect(() => { onValidChangeRef.current?.(!advancedInvalid) }, [advancedInvalid])

  // Debounce next-run API call (task 2.10)
  useEffect(() => {
    if (!isValidCronExpression(currentCron)) {
      setNextRun(null)
      return
    }
    const timer = setTimeout(async () => {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
        const res = await fetch(`/api/cron/next-run?expr=${encodeURIComponent(currentCron)}&tz=${encodeURIComponent(tz)}`)
        if (res.ok) {
          const data = await res.json() as { human?: string }
          setNextRun(data.human ?? null)
        } else {
          setNextRun(null)
        }
      } catch {
        setNextRun(null)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [currentCron])

  // Apply a partial state patch and propagate to parent
  function applyPatch(patch: Partial<SchedulerState>) {
    setState(prev => {
      const next = { ...prev, ...patch }
      const cron = next.showAdvanced ? next.rawExpr : schedulerStateToCron(next)
      if (!next.showAdvanced || isValidCronExpression(cron)) {
        onChange(cron)
      }
      return next
    })
  }

  function selectMode(mode: FrequencyMode) {
    setState(prev => {
      const next: SchedulerState = {
        ...prev,
        mode,
        showAdvanced: false,
        weekdays: mode === 'weekly' && !prev.weekdays.length ? [1] : prev.weekdays,
      }
      onChange(schedulerStateToCron(next))
      return next
    })
    onValidChangeRef.current?.(true)
  }

  function toggleWeekday(day: number) {
    setState(prev => {
      if (prev.weekdays.includes(day)) {
        if (prev.weekdays.length === 1) return prev // must keep at least one
        const next = { ...prev, weekdays: prev.weekdays.filter(d => d !== day) }
        onChange(schedulerStateToCron(next))
        return next
      }
      const next = { ...prev, weekdays: [...prev.weekdays, day].sort((a, b) => a - b) }
      onChange(schedulerStateToCron(next))
      return next
    })
  }

  function handleAdvancedInput(raw: string) {
    const valid = isValidCronExpression(raw)
    setState(prev => ({ ...prev, rawExpr: raw }))
    onValidChangeRef.current?.(valid)
    if (valid) onChange(raw)
  }

  function toggleAdvanced() {
    if (state.showAdvanced) {
      // Collapse: try to re-match a structured mode
      const parsed = parseCronToSchedulerState(state.rawExpr)
      if (parsed.mode !== 'custom') {
        setState(parsed)
        onChange(schedulerStateToCron(parsed))
      } else {
        const fallback = parseCronToSchedulerState('0 9 * * 1-5')
        setState(fallback)
        onChange('0 9 * * 1-5')
      }
      onValidChangeRef.current?.(true)
    } else {
      // Expand: pre-fill with current structured cron
      setState(prev => ({ ...prev, showAdvanced: true, rawExpr: currentCron }))
      onValidChangeRef.current?.(true)
    }
  }

  const previewText = advancedInvalid ? null : cronToHumanReadable(currentCron, true)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>

      {/* Mode buttons — always visible; deselected when advanced is open */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        {MODES.map(({ label, value: modeVal }) => {
          const active = !state.showAdvanced && state.mode === modeVal
          return (
            <button
              key={modeVal}
              onClick={() => selectMode(modeVal)}
              style={{
                padding: '0.3rem 0.65rem',
                borderRadius: '6px',
                border: `1px solid ${active ? blue : border}`,
                backgroundColor: active ? blueDim : surface,
                color: active ? blue : subtext,
                cursor: 'pointer',
                fontSize: '0.8125rem',
                fontWeight: active ? 600 : 400,
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* Time selectors */}
      {!state.showAdvanced && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ fontSize: '0.75rem', color: muted }}>时间</span>
          <select
            value={state.hour}
            onChange={e => applyPatch({ hour: parseInt(e.target.value, 10) })}
            style={selectStyle}
          >
            {Array.from({ length: 24 }, (_, i) => (
              <option key={i} value={i}>{String(i).padStart(2, '0')}</option>
            ))}
          </select>
          <span style={{ color: muted }}>:</span>
          <select
            value={state.minute}
            onChange={e => applyPatch({ minute: parseInt(e.target.value, 10) })}
            style={selectStyle}
          >
            {MINUTES.map(m => (
              <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
            ))}
          </select>
        </div>
      )}

      {/* Weekly: weekday multi-select */}
      {!state.showAdvanced && state.mode === 'weekly' && (
        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
          {WEEKDAYS.map(({ label, value: day }) => {
            const selected = state.weekdays.includes(day)
            return (
              <button
                key={day}
                onClick={() => toggleWeekday(day)}
                style={{
                  padding: '0.25rem 0.45rem',
                  borderRadius: '4px',
                  border: `1px solid ${selected ? blue : border}`,
                  backgroundColor: selected ? blueDim : surface,
                  color: selected ? blue : muted,
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}

      {/* Monthly: day-of-month select */}
      {!state.showAdvanced && state.mode === 'monthly' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span style={{ fontSize: '0.75rem', color: muted }}>每月</span>
          <select
            value={state.monthDay}
            onChange={e => applyPatch({ monthDay: parseInt(e.target.value, 10) })}
            style={selectStyle}
          >
            {Array.from({ length: 31 }, (_, i) => (
              <option key={i + 1} value={i + 1}>{i + 1} 日</option>
            ))}
          </select>
        </div>
      )}

      {/* Advanced cron text input */}
      {state.showAdvanced && (
        <input
          value={state.rawExpr}
          onChange={e => handleAdvancedInput(e.target.value)}
          placeholder="*/5 * * * *"
          spellCheck={false}
          style={{
            backgroundColor: surface,
            border: `1px solid ${advancedInvalid ? red : border}`,
            borderRadius: '6px',
            padding: '0.4rem 0.6rem',
            color: text,
            width: '100%',
            boxSizing: 'border-box',
            fontFamily: 'monospace',
            fontSize: '0.8125rem',
          }}
        />
      )}

      {/* Advanced toggle link */}
      <button
        onClick={toggleAdvanced}
        style={{
          background: 'none',
          border: 'none',
          color: muted,
          cursor: 'pointer',
          fontSize: '0.7rem',
          padding: 0,
          textAlign: 'left',
          textDecoration: 'underline',
          width: 'fit-content',
        }}
      >
        {state.showAdvanced ? '▾ 收起' : '高级：手动输入 cron 表达式 ▸'}
      </button>

      {/* Preview */}
      <div style={{ fontSize: '0.75rem' }}>
        {advancedInvalid ? (
          <span style={{ color: red }}>无效的 cron 表达式</span>
        ) : (
          <span style={{ color: subtext }} title={currentCron}>
            {previewText}
          </span>
        )}
        {nextRun && !advancedInvalid && (
          <div style={{ color: muted, marginTop: '0.15rem' }}>
            下次执行：{nextRun}
          </div>
        )}
      </div>

    </div>
  )
}
