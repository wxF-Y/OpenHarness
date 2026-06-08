import { create } from 'zustand'
import type { ModalData, SelectOption } from '../types/protocol'

export type AppView = 'chat' | 'memory' | 'skills' | 'experts' | 'cron' | 'swarm' | 'autopilot' | 'permissions' | 'models'

export interface SelectModalState {
  kind: 'select'
  title: string
  command: string
  options: SelectOption[]
}

export type ActiveModal =
  | (ModalData & { kind: 'permission' | 'question' })
  | SelectModalState
  | null

export interface ErrorToast {
  id: string
  message: string
  createdAt: number
  type?: 'error' | 'warning' | 'info'
}

interface UiState {
  activeModal: ActiveModal
  compactPhase: string | null
  errorToasts: ErrorToast[]
  activeView: AppView
  activeChatSessionId: string | null
  sidebarRefreshKey: number
  expertRoleLabels: Record<string, string>
  teamSessionTask: Record<string, string>
  setActiveModal: (modal: ActiveModal) => void
  setCompactPhase: (phase: string | null) => void
  addErrorToast: (message: string, type?: 'error' | 'warning' | 'info') => void
  removeErrorToast: (id: string) => void
  setActiveView: (view: AppView) => void
  setActiveChatSessionId: (id: string | null) => void
  incrementSidebarRefreshKey: () => void
  /** Full replacement — use after a complete session list fetch */
  setExpertRoleLabels: (labels: Record<string, string>) => void
  /** Remove a single session's label (used on session delete) */
  removeExpertRoleLabel: (sessionId: string) => void
  /** Store task content for a team session */
  setTeamSessionTask: (sessionId: string, task: string) => void
}

export const useUiStore = create<UiState>((set) => ({
  activeModal: null,
  compactPhase: null,
  errorToasts: [],
  activeView: 'chat',
  activeChatSessionId: null,
  sidebarRefreshKey: 0,
  expertRoleLabels: {},
  teamSessionTask: {},

  setActiveModal: (activeModal) => set({ activeModal }),
  setCompactPhase: (compactPhase) => set({ compactPhase }),
  addErrorToast: (message, type = 'error') =>
    set((prev) => ({
      errorToasts: [
        ...prev.errorToasts,
        { id: crypto.randomUUID(), message, createdAt: Date.now(), type },
      ],
    })),
  removeErrorToast: (id) =>
    set((prev) => ({ errorToasts: prev.errorToasts.filter((t) => t.id !== id) })),
  setActiveView: (activeView) => set({ activeView }),
  setActiveChatSessionId: (activeChatSessionId) => set({ activeChatSessionId }),
  incrementSidebarRefreshKey: () => set((prev) => ({ sidebarRefreshKey: prev.sidebarRefreshKey + 1 })),
  setExpertRoleLabels: (expertRoleLabels) => set({ expertRoleLabels }),
  removeExpertRoleLabel: (sessionId) =>
    set((prev) => {
      if (!(sessionId in prev.expertRoleLabels)) return prev
      const next = { ...prev.expertRoleLabels }
      delete next[sessionId]
      return { expertRoleLabels: next }
    }),
  setTeamSessionTask: (sessionId, task) =>
    set((prev) => ({ teamSessionTask: { ...prev.teamSessionTask, [sessionId]: task } })),
}))
