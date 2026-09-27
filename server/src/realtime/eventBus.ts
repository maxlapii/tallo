import { EventEmitter } from 'node:events';
import { currentTenant } from '../tenancy/context.js';

/**
 * Domain events broadcast to connected devices over Server-Sent Events.
 * Services emit these *after* their transaction commits so subscribers never
 * observe uncommitted state.
 */
export type LiveEvent =
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

export type LiveEventType = LiveEvent['type'];

export type ScopedEvent = LiveEvent & { store: string };

class EventBus extends EventEmitter {
  /** Broadcasts within the store bound to the current request (or 'default'). */
  broadcast(event: LiveEvent): void {
    const store = currentTenant()?.slug ?? 'default';
    this.emit('event', { ...event, store } as ScopedEvent);
  }

  subscribe(listener: (event: ScopedEvent) => void): () => void {
    this.on('event', listener);
    return () => this.off('event', listener);
  }
}

/** Single process-wide bus. Sufficient for one API server (SQLite deployment). */
export const eventBus = new EventBus();
eventBus.setMaxListeners(0);
