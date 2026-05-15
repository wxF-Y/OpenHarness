import { useCallback, useEffect, useRef } from 'react'
import type { BackendEvent, FrontendRequest } from '../types/protocol'
import { useSessionStore } from '../stores/sessionStore'
import { useTaskStore } from '../stores/taskStore'
import { useSwarmStore } from '../stores/swarmStore'
import { useUiStore } from '../stores/uiStore'

const MAX_RETRY_DELAY = 30000
const BASE_RETRY_DELAY = 1000

export function useWebSocket(sessionId: string | null) {
  const wsRef = useRef<WebSocket | null>(null)
  const retryDelayRef = useRef(BASE_RETRY_DELAY)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const terminatedRef = useRef(false)

  const sessionStore = useSessionStore()
  const taskStore = useTaskStore()
  const swarmStore = useSwarmStore()
  const uiStore = useUiStore()

  const dispatch = useCallback(
    (event: BackendEvent) => {
      switch (event.type) {
        case 'ready':
          if (event.state) sessionStore.setAppState(event.state)
          if (event.tasks) taskStore.setTasks(event.tasks)
          if (event.commands) sessionStore.setCommands(event.commands)
          if (event.mcp_servers) sessionStore.setMcpServers(event.mcp_servers)
          if (event.bridge_sessions) sessionStore.setBridgeSessions(event.bridge_sessions)
          sessionStore.setWsStatus('ready')
          sessionStore.setBusy(false)
          break

        case 'state_snapshot':
          if (event.state) sessionStore.setAppState(event.state)
          if (event.mcp_servers) sessionStore.setMcpServers(event.mcp_servers)
          if (event.bridge_sessions) sessionStore.setBridgeSessions(event.bridge_sessions)
          break

        case 'transcript_item':
          if (event.item) sessionStore.addTranscriptItem(event.item)
          break

        case 'assistant_delta':
          if (event.message) sessionStore.appendDelta(event.message)
          break

        case 'assistant_complete':
          if (event.message) sessionStore.completeAssistant(event.message)
          break

        case 'line_complete':
          sessionStore.setBusy(false)
          break

        case 'tool_started':
          if (event.item) sessionStore.addTranscriptItem(event.item)
          break

        case 'tool_completed':
          if (event.item) sessionStore.addTranscriptItem(event.item)
          break

        case 'tasks_snapshot':
          if (event.tasks) taskStore.setTasks(event.tasks)
          break

        case 'todo_update':
          taskStore.setTodoMarkdown(event.todo_markdown ?? null)
          break

        case 'compact_progress':
          uiStore.setCompactPhase(event.compact_phase ?? null)
          break

        case 'clear_transcript':
          sessionStore.clearTranscript()
          break

        case 'modal_request': {
          const modal = event.modal as Record<string, unknown>
          if (modal?.kind === 'permission') {
            uiStore.setActiveModal({
              kind: 'permission',
              request_id: modal.request_id as string,
              tool_name: modal.tool_name as string | undefined,
              reason: modal.reason as string | undefined,
            })
          } else if (modal?.kind === 'question') {
            uiStore.setActiveModal({
              kind: 'question',
              request_id: modal.request_id as string,
              question: modal.question as string | undefined,
            })
          }
          break
        }

        case 'select_request': {
          const modal = event.modal as Record<string, unknown> | undefined
          uiStore.setActiveModal({
            kind: 'select',
            title: (modal?.title as string) || 'Select',
            command: (modal?.command as string) || '',
            options: event.select_options ?? [],
          })
          break
        }

        case 'plan_mode_change':
          sessionStore.setPlanMode(event.plan_mode ?? 'default')
          break

        case 'swarm_status':
          if (event.swarm_teammates) swarmStore.setTeammates(event.swarm_teammates)
          if (event.swarm_notifications) swarmStore.addNotifications(event.swarm_notifications)
          break

        case 'error':
          if (event.message) uiStore.addErrorToast(event.message)
          break

        case 'shutdown':
          sessionStore.setTerminated()
          terminatedRef.current = true
          break
      }
    },
    [sessionStore, taskStore, swarmStore, uiStore],
  )

  const connect = useCallback(() => {
    if (!sessionId || terminatedRef.current) return
    sessionStore.setWsStatus('connecting')

    const ws = new WebSocket(`ws://localhost:8000/ws/${sessionId}`)
    wsRef.current = ws

    ws.onopen = () => {
      retryDelayRef.current = BASE_RETRY_DELAY
    }

    ws.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as BackendEvent
        dispatch(event)
      } catch {
        // ignore malformed messages
      }
    }

    ws.onclose = (e) => {
      if (terminatedRef.current) return
      sessionStore.setWsStatus('disconnected')
      // Exponential backoff retry (not for intentional shutdown)
      if (e.code !== 4004) {
        retryTimerRef.current = setTimeout(() => {
          retryDelayRef.current = Math.min(retryDelayRef.current * 2, MAX_RETRY_DELAY)
          connect()
        }, retryDelayRef.current)
      }
    }

    ws.onerror = () => {
      ws.close()
    }
  }, [sessionId, dispatch, sessionStore])

  useEffect(() => {
    terminatedRef.current = false
    connect()
    return () => {
      terminatedRef.current = true
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      wsRef.current?.close()
    }
  }, [connect])

  const sendRequest = useCallback((req: FrontendRequest) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(req))
    }
  }, [])

  return { sendRequest }
}
