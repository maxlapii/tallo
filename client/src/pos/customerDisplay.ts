import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Customer-facing display protocol. The POS window publishes the live order
 * over a BroadcastChannel; the /display window (dragged to the second screen)
 * renders it. Same browser, same origin, no server round-trip.
 */
export const DISPLAY_CHANNEL = 'pos-customer-display';
export const DISPLAY_WINDOW_NAME = 'pos-customer-display';

export interface DisplayLine {
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  imageUrl: string | null;
}

export type DisplayState =
  | { mode: 'idle'; storeName: string }
  | {
      mode: 'order';
      storeName: string;
      lines: DisplayLine[];
      subtotal: number;
      discount: number;
      tax: number;
      total: number;
      customerName: string | null;
    }
  | {
      mode: 'paid';
      storeName: string;
      receiptNo: string;
      total: number;
      received: number;
      change: number;
      methods: string[];
    };

type Message =
  | { type: 'state'; state: DisplayState }
  | { type: 'hello' } // display asks for the current state
  | { type: 'ping' }; // display heartbeat

const HEARTBEAT_MS = 3000;
const STALE_MS = 8000;

function openChannel(): BroadcastChannel | null {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(DISPLAY_CHANNEL);
}

/** POS side: publish state, know whether a display window is listening, open one. */
export function useCustomerDisplayPublisher(state: DisplayState) {
  const channel = useRef<BroadcastChannel | null>(null);
  const latest = useRef(state);
  const lastPing = useRef(0);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    latest.current = state;
    channel.current?.postMessage({ type: 'state', state } satisfies Message);
  }, [state]);

  useEffect(() => {
    const ch = openChannel();
    channel.current = ch;
    if (!ch) return;
    ch.onmessage = (e: MessageEvent<Message>) => {
      if (e.data.type === 'hello')
        ch.postMessage({ type: 'state', state: latest.current } satisfies Message);
      if (e.data.type === 'hello' || e.data.type === 'ping') {
        lastPing.current = Date.now();
        setConnected(true);
      }
    };
    const timer = window.setInterval(() => {
      if (Date.now() - lastPing.current > STALE_MS) setConnected(false);
    }, 2000);
    return () => {
      window.clearInterval(timer);
      ch.close();
      channel.current = null;
    };
  }, []);

  const openDisplay = useCallback(async () => {
    let features = 'popup=yes,width=1100,height=760';
    try {
      // Window Management API: place the display on a second screen when one exists.
      const w = window as Window & {
        getScreenDetails?: () => Promise<{
          screens: {
            isPrimary: boolean;
            availLeft: number;
            availTop: number;
            availWidth: number;
            availHeight: number;
          }[];
        }>;
      };
      if (w.getScreenDetails) {
        const details = await w.getScreenDetails();
        const other = details.screens.find((s) => !s.isPrimary);
        if (other)
          features = `popup=yes,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
      }
    } catch {
      // permission denied or unsupported: fall back to a normal popup
    }
    const win = window.open('/display', DISPLAY_WINDOW_NAME, features);
    win?.focus();
    return win !== null;
  }, []);

  return { connected, openDisplay };
}

/** Display side: receive state and send heartbeats. */
export function useCustomerDisplaySubscriber(initial: DisplayState) {
  const [state, setState] = useState<DisplayState>(initial);
  const [linked, setLinked] = useState(false);
  useEffect(() => {
    const ch = openChannel();
    if (!ch) return;
    ch.onmessage = (e: MessageEvent<Message>) => {
      if (e.data.type === 'state') {
        setState(e.data.state);
        setLinked(true);
      }
    };
    ch.postMessage({ type: 'hello' } satisfies Message);
    const beat = window.setInterval(
      () => ch.postMessage({ type: 'ping' } satisfies Message),
      HEARTBEAT_MS,
    );
    return () => {
      window.clearInterval(beat);
      ch.close();
    };
  }, []);
  return { state, linked };
}

/** Full-screen helper shared by the POS toolbar. */
export function useFullscreen() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const sync = () =>
      setActive(
        Boolean(document.fullscreenElement) || document.body.classList.contains('pos-fullscreen'),
      );
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  useEffect(() => {
    document.body.classList.toggle('pos-fullscreen', active);
    return () => document.body.classList.remove('pos-fullscreen');
  }, [active]);
  const toggle = useCallback(async () => {
    const next = !active;
    setActive(next);
    try {
      if (next && !document.fullscreenElement) await document.documentElement.requestFullscreen?.();
      else if (!next && document.fullscreenElement) await document.exitFullscreen?.();
    } catch {
      // Fullscreen API unavailable (e.g. iOS): the chrome is still hidden via the body class.
    }
  }, [active]);
  // Leaving browser full screen with Esc should also leave kiosk mode.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && active && wasFullscreen.current) setActive(false);
      wasFullscreen.current = Boolean(document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [active]);
  const wasFullscreen = useRef(false);
  return { active, toggle };
}
