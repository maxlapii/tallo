import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getToken } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { money } from '../utils/format';

export type LiveEvent =
  | { type: 'connected'; payload: { userId: number; role: string; at: string } }
  | {
      type: 'sale.created';
      payload: {
        saleId: number;
        receiptNo: string;
        total: number;
        cashierId: number;
        cashierName: string;
        itemCount: number;
        createdAt: string;
      };
    }
  | {
      type: 'stock.changed';
      payload: { products: { productId: number; sku: string; stockQty: number }[] };
    }
  | {
      type: 'refund.created';
      payload: { saleId: number; refundId: number; total: number; userId: number };
    }
  | {
      type: 'register.changed';
      payload: { registerId: number; userId: number; status: 'OPEN' | 'CLOSED' };
    }
  | {
      type: 'print.job';
      payload: {
        jobId: number;
        printerId: number;
        printerArea: string;
        kind: 'RECEIPT' | 'TICKET';
        saleId: number;
        receiptNo: string;
        status: string;
      };
    };

type Listener = (event: LiveEvent) => void;

interface RealtimeApi {
  connected: boolean;
  subscribe: (listener: Listener) => () => void;
}

const RealtimeContext = createContext<RealtimeApi | undefined>(undefined);
const EVENT_TYPES: LiveEvent['type'][] = [
  'connected',
  'sale.created',
  'stock.changed',
  'refund.created',
  'register.changed',
  'print.job',
];

/**
 * One Server-Sent Events connection per signed-in session. Pages subscribe to
 * domain events (new orders, stock changes, register changes) and refresh
 * themselves, so every device shows the same state without polling.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const toast = useToast();
  const listeners = useRef(new Set<Listener>());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!user || !token || typeof EventSource === 'undefined') {
      setConnected(false);
      return;
    }
    const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    const dispatch = (type: LiveEvent['type']) => (raw: MessageEvent) => {
      let payload: unknown;
      try {
        payload = JSON.parse(raw.data as string);
      } catch {
        return;
      }
      const event = { type, payload } as LiveEvent;
      if (type === 'connected') setConnected(true);
      for (const l of listeners.current) l(event);
    };
    for (const t of EVENT_TYPES) es.addEventListener(t, dispatch(t));
    es.onerror = () => setConnected(false);
    return () => {
      es.close();
      setConnected(false);
    };
  }, [user]);

  // Global order feed: tell cashiers/admins when another device places an order.
  useEffect(() => {
    if (!user || user.role === 'SALE') return;
    const off = subscribeInternal(listeners.current, (e) => {
      if (e.type === 'sale.created' && e.payload.cashierId !== user.id) {
        toast.notify(
          `New order #${e.payload.receiptNo} · ${money(e.payload.total)} from ${e.payload.cashierName}`,
          'info',
        );
      }
    });
    return off;
  }, [user, toast]);

  const subscribe = useCallback(
    (listener: Listener) => subscribeInternal(listeners.current, listener),
    [],
  );
  const value = useMemo(() => ({ connected, subscribe }), [connected, subscribe]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

function subscribeInternal(set: Set<Listener>, listener: Listener): () => void {
  set.add(listener);
  return () => set.delete(listener);
}

export function useRealtime(): RealtimeApi {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error('useRealtime must be used within RealtimeProvider');
  return ctx;
}

/** Subscribe to live events for the lifetime of a component. Wrap `handler` in useCallback. */
export function useLiveEvents(handler: Listener): void {
  const { subscribe } = useRealtime();
  useEffect(() => subscribe(handler), [subscribe, handler]);
}
