export type FrequencyMode = 'daily' | 'workday' | 'weekly' | 'monthly' | 'custom'

export interface SchedulerState {
  mode: FrequencyMode
  hour: number
  minute: number
  weekdays: number[]   // 0=Sun, 1=Mon … 6=Sat; UI shows Mon-Sun but stores 0-6
  monthDay: number     // 1-31
  rawExpr: string      // used in custom/advanced mode
  showAdvanced: boolean
}

// ─── helpers ────────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Normalise Sunday: replace standalone 7 with 0 in a dow field string. */
function normaliseSunday(dow: string): string {
  return dow.replace(/(^|,)7(,|$)/g, '$10$2').replace(/^7$/, '0')
}

/**
 * Validate a single cron field against [min, max].
 * Supports: *, *\/N, A-B, A-B\/N, comma-separated combinations.
 */
function isFieldValid(field: string, min: number, max: number): boolean {
  if (field === '*') return true

  // */N — any step >= 1 is valid (croniter semantics)
  if (/^\*\/\d+$/.test(field)) {
    const n = parseInt(field.slice(2), 10)
    return n >= 1
  }

  // comma-separated — recurse on each part
  if (field.includes(',')) {
    return field.split(',').every(p => isFieldValid(p.trim(), min, max))
  }

  // A-B or A-B/N
  const rangeMatch = field.match(/^(\d+)-(\d+)(?:\/(\d+))?$/)
  if (rangeMatch) {
    const a = parseInt(rangeMatch[1], 10)
    const b = parseInt(rangeMatch[2], 10)
    if (a < min || b > max || a > b) return false
    if (rangeMatch[3] !== undefined) {
      const step = parseInt(rangeMatch[3], 10)
      if (step < 1) return false
    }
    return true
  }

  // plain integer
  const n = parseInt(field, 10)
  return !isNaN(n) && n >= min && n <= max
}

// ─── 1.4: isValidCronExpression ─────────────────────────────────────────────

/** Field-domain validation matching backend croniter.is_valid() semantics. */
export function isValidCronExpression(expr: string): boolean {
  if (!expr || !expr.trim()) return false
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return false
  const [minute, hour, dom, month, dow] = fields
  return (
    isFieldValid(minute, 0, 59) &&
    isFieldValid(hour, 0, 23) &&
    isFieldValid(dom, 1, 31) &&
    isFieldValid(month, 1, 12) &&
    isFieldValid(normaliseSunday(dow), 0, 6) // after 7→0 normalisation
  )
}

// ─── 1.2: parseCronToSchedulerState ─────────────────────────────────────────

const DEFAULT_STATE: SchedulerState = {
  mode: 'workday',
  hour: 9,
  minute: 0,
  weekdays: [1, 2, 3, 4, 5],
  monthDay: 1,
  rawExpr: '0 9 * * 1-5',
  showAdvanced: false,
}

function isWorkdayDow(dow: string): boolean {
  if (dow === '1-5') return true
  const parts = dow.split(',').map(Number)
  if (parts.some(isNaN)) return false
  return (
    parts.length === 5 &&
    JSON.stringify([...parts].sort((a, b) => a - b)) === '[1,2,3,4,5]'
  )
}

export function parseCronToSchedulerState(expr: string): SchedulerState {
  if (!expr || !expr.trim()) return { ...DEFAULT_STATE }

  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) {
    return { ...DEFAULT_STATE, mode: 'custom', showAdvanced: true, rawExpr: expr }
  }

  const [minF, hourF, domF, monthF, dowF] = fields
  const normDow = normaliseSunday(dowF)

  // Both minute and hour must be simple integers to match structured modes.
  // Complex expressions like "0,30" or "9-21" or "*/2" fall through to custom.
  const simpleHour = /^\d+$/.test(hourF)
  const simpleMinute = /^\d+$/.test(minF)
  if (!simpleHour || !simpleMinute) {
    return { ...DEFAULT_STATE, mode: 'custom', showAdvanced: true, rawExpr: expr }
  }

  const hour = parseInt(hourF, 10)
  const minute = parseInt(minF, 10)

  // every day: M H * * *
  if (domF === '*' && monthF === '*' && normDow === '*') {
    return { mode: 'daily', hour, minute, weekdays: [1], monthDay: 1, rawExpr: expr, showAdvanced: false }
  }

  // workday: M H * * 1-5  or  M H * * 1,2,3,4,5
  if (domF === '*' && monthF === '*' && isWorkdayDow(normDow)) {
    return { mode: 'workday', hour, minute, weekdays: [1, 2, 3, 4, 5], monthDay: 1, rawExpr: expr, showAdvanced: false }
  }

  // weekly: M H * * D  (comma-separated single digits, not a range like 1-5)
  if (domF === '*' && monthF === '*' && normDow !== '*' && !normDow.includes('-')) {
    const wds = normDow.split(',').map(Number)
    if (wds.every(d => !isNaN(d) && d >= 0 && d <= 6)) {
      return {
        mode: 'weekly',
        hour,
        minute,
        weekdays: [...wds].sort((a, b) => a - b),
        monthDay: 1,
        rawExpr: expr,
        showAdvanced: false,
      }
    }
  }

  // monthly: M H D * *
  if (monthF === '*' && normDow === '*' && /^\d+$/.test(domF)) {
    const day = parseInt(domF, 10)
    if (day >= 1 && day <= 31) {
      return { mode: 'monthly', hour, minute, weekdays: [1], monthDay: day, rawExpr: expr, showAdvanced: false }
    }
  }

  return { ...DEFAULT_STATE, mode: 'custom', showAdvanced: true, rawExpr: expr }
}

// ─── 1.3: schedulerStateToCron ───────────────────────────────────────────────

export function schedulerStateToCron(state: SchedulerState): string {
  if (state.mode === 'custom') return state.rawExpr
  const m = String(state.minute)
  const h = String(state.hour)
  switch (state.mode) {
    case 'daily':
      return `${m} ${h} * * *`
    case 'workday':
      return `${m} ${h} * * 1-5`
    case 'weekly': {
      const sorted = [...state.weekdays].sort((a, b) => a - b)
      return `${m} ${h} * * ${sorted.join(',')}`
    }
    case 'monthly':
      return `${m} ${h} ${state.monthDay} * *`
  }
}

// ─── 1.1: cronToHumanReadable ────────────────────────────────────────────────

// Index: 0=Sun, 1=Mon … 6=Sat  (matches weekday number stored in SchedulerState)
const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六']

function weekdaysLabel(wds: number[]): string {
  return [...wds]
    .sort((a, b) => a - b)
    .map(d => WEEKDAY_SHORT[d])
    .join('、')
}

/** Try to produce a friendly description for "custom" cron expressions. */
function describeCustomCron(expr: string): string {
  const f = expr.trim().split(/\s+/)
  if (f.length !== 5) return expr.trim()
  const [min, hour, dom, month, dow] = f

  // Every N minutes: */N * * * *
  if (/^\*\/\d+$/.test(min) && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    const n = parseInt(min.slice(2), 10)
    return n === 1 ? '每分钟' : `每 ${n} 分钟`
  }

  // Every N hours (at minute 0): 0 */N * * *
  if (min === '0' && /^\*\/\d+$/.test(hour) && dom === '*' && month === '*' && dow === '*') {
    const n = parseInt(hour.slice(2), 10)
    return n === 1 ? '每小时整点' : `每 ${n} 小时整点`
  }

  // Hourly within a range: 0 A-B * * *
  if (min === '0' && /^\d+-\d+$/.test(hour) && dom === '*' && month === '*' && dow === '*') {
    const [from, to] = hour.split('-').map(Number)
    return `每小时整点（${pad2(from)}:00–${pad2(to)}:00）`
  }

  // Specific hours (comma list): 0 A,B,... * * *
  if (min === '0' && /^\d+(,\d+)+$/.test(hour) && dom === '*' && month === '*' && dow === '*') {
    const times = hour.split(',').map(h => `${pad2(Number(h))}:00`).join('、')
    return `每天 ${times}`
  }

  // Specific hours on workdays: 0 A,B * * 1-5  or  0 A-B * * 1-5
  if (min === '0' && dom === '*' && month === '*' && (dow === '1-5' || dow === '1,2,3,4,5')) {
    if (/^\d+(,\d+)+$/.test(hour)) {
      const times = hour.split(',').map(h => `${pad2(Number(h))}:00`).join('、')
      return `工作日 ${times}`
    }
    if (/^\d+-\d+$/.test(hour)) {
      const [from, to] = hour.split('-').map(Number)
      return `工作日每小时整点（${pad2(from)}:00–${pad2(to)}:00）`
    }
  }

  // Fallback: still raw but trimmed
  return expr.trim()
}

/**
 * Convert a cron expression to human-readable Chinese.
 * @param verbose  true (default) = "每个工作日 09:00 重复执行"  (picker preview)
 *                 false          = "工作日 09:00"               (table cell)
 */
export function cronToHumanReadable(expr: string, verbose = true): string {
  if (!expr || !expr.trim()) return '--'

  const state = parseCronToSchedulerState(expr)
  if (state.mode === 'custom') return describeCustomCron(expr)

  const time = `${pad2(state.hour)}:${pad2(state.minute)}`

  if (verbose) {
    switch (state.mode) {
      case 'daily':   return `每天 ${time} 重复执行`
      case 'workday': return `每个工作日 ${time} 重复执行`
      case 'weekly':  return `每周${weekdaysLabel(state.weekdays)} ${time} 重复执行`
      case 'monthly': return `每月 ${state.monthDay} 日 ${time} 重复执行`
    }
  } else {
    switch (state.mode) {
      case 'daily':   return `每天 ${time}`
      case 'workday': return `工作日 ${time}`
      case 'weekly':  return `每周${weekdaysLabel(state.weekdays)} ${time}`
      case 'monthly': return `每月 ${state.monthDay} 日 ${time}`
    }
  }

  return expr.trim()
}
