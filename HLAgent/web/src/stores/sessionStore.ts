import { create } from 'zustand'
import type { AppState, BridgeSessionSnapshot, McpServerSnapshot, TranscriptItem } from '../types/protocol'

export type WsStatus = 'connecting' | 'ready' | 'disconnected' | 'terminated'

interface SessionState {
  sessionId: string | null
  wsStatus: WsStatus
  appState: AppState | null
  transcript: TranscriptItem[]
  assistantBuffer: string
  thinkingBuffer: string
  commands: string[]
  mcpServers: McpServerSnapshot[]
  bridgeSessions: BridgeSessionSnapshot[]
  busy: boolean
  planMode: string
  busyLabel?: string
  // Actions
  setSessionId: (id: string) => void
  setWsStatus: (status: WsStatus) => void
  setAppState: (state: Partial<AppState>) => void
  setCommands: (commands: string[]) => void
  setMcpServers: (servers: McpServerSnapshot[]) => void
  setBridgeSessions: (sessions: BridgeSessionSnapshot[]) => void
  addTranscriptItem: (item: TranscriptItem) => void
  appendDelta: (text: string) => void
  appendThinkingDelta: (text: string) => void
  completeAssistant: (text: string) => void
  clearTranscript: () => void
  setBusy: (busy: boolean, label?: string) => void
  setPlanMode: (mode: string) => void
  setTerminated: () => void
  reset: () => void
  resetAndSetSession: (id: string) => void
}

export const useSessionStore = create<SessionState>((set) => ({
  sessionId: null,
  wsStatus: 'disconnected',
  appState: null,
  transcript: [],
  assistantBuffer: '',
  thinkingBuffer: '',
  commands: [],
  mcpServers: [],
  bridgeSessions: [],
  busy: false,
  planMode: 'default',

  setSessionId: (id) => set({ sessionId: id }),
  setWsStatus: (wsStatus) => set({ wsStatus }),
  setAppState: (state) =>
    set((prev) => ({
      appState: prev.appState ? { ...prev.appState, ...state } : (state as AppState),
      planMode: (state as AppState).permission_mode ?? prev.planMode,
    })),
  setCommands: (commands) => set({ commands }),
  setMcpServers: (mcpServers) => set({ mcpServers }),
  setBridgeSessions: (bridgeSessions) => set({ bridgeSessions }),
  addTranscriptItem: (item) =>
    set((prev) => ({ transcript: [...prev.transcript, item], assistantBuffer: '', thinkingBuffer: '' })),
  appendDelta: (text) => set((prev) => ({ assistantBuffer: prev.assistantBuffer + text })),
  appendThinkingDelta: (text) => set((prev) => ({ thinkingBuffer: prev.thinkingBuffer + text })),
  completeAssistant: (text) =>
    set((prev) => {
      const hasContent = text.trim() || prev.thinkingBuffer
      return {
        assistantBuffer: '',
        thinkingBuffer: '',
        transcript: hasContent
          ? [
              ...prev.transcript,
              {
                role: 'assistant' as const,
                text,
                thinking: prev.thinkingBuffer || undefined,
              },
            ]
          : prev.transcript,
      }
    }),
  clearTranscript: () => set({ transcript: [], assistantBuffer: '', thinkingBuffer: '' }),
  setBusy: (busy, label?) => set({ busy, busyLabel: label }),
  setPlanMode: (planMode) => set({ planMode }),
  setTerminated: () => set({ wsStatus: 'terminated', busy: false }),
  reset: () =>
    set({
      transcript: [],
      assistantBuffer: '',
      thinkingBuffer: '',
      commands: [],
      mcpServers: [],
      bridgeSessions: [],
      busy: false,
      planMode: 'default',
      appState: null,
    }),
  resetAndSetSession: (id) =>
    set({
      sessionId: id,
      wsStatus: 'disconnected',
      transcript: [],
      assistantBuffer: '',
      thinkingBuffer: '',
      commands: [],
      mcpServers: [],
      bridgeSessions: [],
      busy: false,
      planMode: 'default',
      appState: null,
    }),
}))
