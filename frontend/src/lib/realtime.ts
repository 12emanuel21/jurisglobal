'use client';

import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';

let shared: Socket | null = null;

/** Socket.io del panel (mismo origen; la cookie httpOnly de sesión autentica el handshake) */
function getSocket(): Socket {
  shared ??= io({ path: '/socket.io/', withCredentials: true, transports: ['websocket', 'polling'] });
  return shared;
}

/** Ejecuta `handler` cuando llega alguno de los eventos (message:new, conversation:updated…) */
export function usePanelEvents(events: string[], handler: (event: string, payload: unknown) => void) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  const key = events.join('|');
  useEffect(() => {
    const socket = getSocket();
    const listeners = key.split('|').map((event) => {
      const fn = (payload: unknown) => ref.current(event, payload);
      socket.on(event, fn);
      return [event, fn] as const;
    });
    return () => listeners.forEach(([event, fn]) => socket.off(event, fn));
  }, [key]);
}
