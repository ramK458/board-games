import { create } from 'zustand';
import type { WsServerMessage } from '../types';

interface WsState {
  connected: boolean;
  ws: WebSocket | null;
  connect: (userId: number) => void;
  disconnect: () => void;
  send: (msg: object) => void;
  subscribe: (scope: 'node', id: number) => void;
  unsubscribe: (scope: 'node', id: number) => void;
  onMessage: ((msg: WsServerMessage) => void) | null;
}

export const useWsStore = create<WsState>((set, get) => ({
  connected: false,
  ws: null,
  onMessage: null,

  connect: (userId) => {
    const existing = get().ws;
    if (existing) existing.close();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/updates?user_id=${userId}`;

    console.log('[WS] Connecting to', wsUrl);
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      console.log('[WS] Connected');
      set({ connected: true, ws });
    };
    ws.onclose = (event) => {
      console.warn('[WS] Disconnected:', event.code, event.reason);
      set({ connected: false, ws: null });
    };
    ws.onerror = (event) => {
      console.error('[WS] Error:', event);
    };
    ws.onmessage = (event) => {
      try {
        const msg: WsServerMessage = JSON.parse(event.data);
        const handler = get().onMessage;
        if (handler) handler(msg);
      } catch { /* ignore parse errors */ }
    };

    set({ ws });
  },

  disconnect: () => {
    get().ws?.close();
    set({ connected: false, ws: null });
  },

  send: (msg) => {
    get().ws?.send(JSON.stringify(msg));
  },

  subscribe: (scope, id) => {
    get().send({ type: 'subscribe', scope, id });
  },

  unsubscribe: (scope, id) => {
    get().send({ type: 'unsubscribe', scope, id });
  },
}));
