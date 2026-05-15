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

  // Use getState() inside callbacks to avoid re-creating dispatch/connect on every store update.
  // Zustand store actions are stable but the snapshot returned by useXxxStore() is not.
  const dispatch = useCallback((event: BackendEvent) => {
    const ss = useSessionStore.getState()
    const ts = useTaskStore.getState()
    const sw = useSwarmStore.getState()
    const ui = useUiStore.getState()

    switch (event.type) {
      case 'ready':
        if (event.state) ss.setAppState(event.state)
        if (event.tasks) ts.setTasks(event.tasks)
        if (event.commands) ss.setCommands(event.commands)
        if (event.mcp_servers) ss.setMcpServers(event.mcp_servers)
        if (event.bridge_sessions) ss.setBridgeSessions(event.bridge_sessions)
        ss.setWsStatus('ready')
        ss.setBusy(false)
        break

      case 'state_snapshot':
        if (event.state) ss.setAppState(event.state)
        if (event.mcp_servers) ss.setMcpServers(event.mcp_servers)
        if (event.bridge_sessions) ss.setBridgeSessions(event.bridge_sessions)
        break

      case 'transcript_item':
        if (event.item) ss.addTranscriptItem(event.item)
        break

      case 'assistant_delta':
        if (event.message) ss.appendDelta(event.message)
        break

      case 'assistant_complete':
        if (event.message) ss.completeAssistant(event.message)
        break

      case 'line_complete':
        ss.setBusy(false)
        break

      case 'tool_started':
        if (event.item) ss.addTranscriptItem(event.item)
        break

      case 'tool_completed':
        if (event.item) ss.addTranscriptItem(event.item)
        break

      case 'tasks_snapshot':
        if (event.tasks) ts.setTasks(event.tasks)
        break

      case 'todo_update':
        ts.setTodoMarkdown(event.todo_markdown ?? null)
        break

      case 'compact_progress':
        ui.setCompactPhase(event.compact_phase ?? null)
        break

      case 'clear_transcript':
        ss.clearTranscript()
        break

      case 'modal_request': {
        const modal = event.modal as Record<string, unknown>
        if (modal?.kind === 'permission') {
          ui.setActiveModal({
            kind: 'permission',
            request_id: modal.request_id as string,
            tool_name: modal.tool_name as string | undefined,
            reason: modal.reason as string | undefined,
          })
        } else if (modal?.kind === 'question') {
          ui.setActiveModal({
            kind: 'question',
            request_id: modal.request_id as string,
            question: modal.question as string | undefined,
          })
        }
        break
      }

      case 'select_request': {
        const modal = event.modal as Record<string, unknown> | undefined
        ui.setActiveModal({
          kind: 'select',
          title: (modal?.title as string) || 'Select',
          command: (modal?.command as string) || '',
          options: event.select_options ?? [],
        })
        break
      }

      case 'plan_mode_change':
        ss.setPlanMode(event.plan_mode ?? 'default')
        break

      case 'swarm_status':
        if (event.swarm_teammates) sw.setTeammates(event.swarm_teammates)
        if (event.swarm_notifications) sw.addNotifications(event.swarm_notifications)
        break

      case 'error':
        if (event.message) ui.addErrorToast(event.message)
        break

      case 'shutdown':
        ss.setTerminated()
        terminatedRef.current = true
        break
    }
  }, []) // empty deps — uses getState() instead of snapshot

  const connect = useCallback(() => {
    if (!sessionId || terminatedRef.current) return
    useSessionStore.getState().setWsStatus('connecting')

    const wsUrl = `ws://localhost:8000/ws/${sessionId}`
    const ws = new WebSocket(wsUrl)
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
      useSessionStore.getState().setWsStatus('disconnected')
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
  }, [sessionId, dispatch]) // sessionId is stable for a given ChatPage mount

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
