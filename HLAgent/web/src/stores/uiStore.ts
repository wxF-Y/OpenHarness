import { create } from 'zustand'
import type { ModalData, SelectOption } from '../types/protocol'

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
}

interface UiState {
  activeModal: ActiveModal
  compactPhase: string | null
  errorToasts: ErrorToast[]
  setActiveModal: (modal: ActiveModal) => void
  setCompactPhase: (phase: string | null) => void
  addErrorToast: (message: string) => void
  removeErrorToast: (id: string) => void
}

export const useUiStore = create<UiState>((set) => ({
  activeModal: null,
  compactPhase: null,
  errorToasts: [],

  setActiveModal: (activeModal) => set({ activeModal }),
  setCompactPhase: (compactPhase) => set({ compactPhase }),
  addErrorToast: (message) =>
    set((prev) => ({
      errorToasts: [
        ...prev.errorToasts,
        { id: crypto.randomUUID(), message, createdAt: Date.now() },
      ],
    })),
  removeErrorToast: (id) =>
    set((prev) => ({ errorToasts: prev.errorToasts.filter((t) => t.id !== id) })),
}))
