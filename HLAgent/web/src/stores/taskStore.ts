import { create } from 'zustand'
import type { TaskSnapshot } from '../types/protocol'

interface TaskState {
  tasks: TaskSnapshot[]
  todoMarkdown: string | null
  setTasks: (tasks: TaskSnapshot[]) => void
  setTodoMarkdown: (md: string | null) => void
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  todoMarkdown: null,
  setTasks: (tasks) => set({ tasks }),
  setTodoMarkdown: (todoMarkdown) => set({ todoMarkdown }),
}))
