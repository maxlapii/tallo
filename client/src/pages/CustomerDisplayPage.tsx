import { useEffect, useState } from 'react';
import { ProductImage } from '../components/ProductImage';
import { Icon } from '../components/Icon';
import { useCustomerDisplaySubscriber } from '../pos/customerDisplay';
import { money } from '../utils/format';

const STORE = 'Tallo';

/**
 * Customer-facing screen for a dual-screen register. Opened from the POS in a
 * second window; shows the running order, then the change due after payment.
 */
export function CustomerDisplayPage() {
  const { state, linked } = useCustomerDisplaySubscriber({ mode: 'idle', storeName: STORE });
  const [clock, setClock] = useState(new Date());
  useEffect(() => {
    document.title = 'Customer display';
    const t = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div className="cd" data-testid="customer-display" data-mode={state.mode}>
      <header className="cd-header">
        <div className="cd-brand">
          <span className="brand-mark">
            <Icon name="cart" size={18} />
          </span>
          {state.storeName}
        </div>
        <div className="cd-clock">
          {clock.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          <span
            className={linked ? 'cd-link on' : 'cd-link'}
            title={linked ? 'Linked to the POS' : 'Waiting for the POS'}
          />
        </div>
      </header>

      {state.mode === 'idle' && (
        <main className="cd-idle">
          <h1>Welcome</h1>
          <p>Your order will appear here.</p>
        </main>
      )}

      {state.mode === 'order' && (
        <main className="cd-order">
          <section className="cd-lines">
            {state.lines.length === 0 ? (
              <div className="cd-empty">Scanning items…</div>
            ) : (
              state.lines.map((l, i) => (
                <div className="cd-line" key={i} data-testid="cd-line">
                  <ProductImage className="cd-thumb" src={l.imageUrl} name={l.name} eager />
                  <div className="cd-line-name">
                    <div>{l.name}</div>
                    <div className="cd-line-meta">
                      {l.quantity} × {money(l.unitPrice)}
                    </div>
                  </div>
                  <div className="cd-line-total">{money(l.lineTotal)}</div>
                </div>
              ))
            )}
          </section>
          <aside className="cd-summary">
            {state.customerName && (
              <div className="cd-customer">Order for {state.customerName}</div>
            )}
            <div className="cd-row">
              <span>Subtotal</span>
              <span>{money(state.subtotal)}</span>
            </div>
            {state.discount > 0 && (
              <div className="cd-row cd-discount">
                <span>Discount</span>
                <span>-{money(state.discount)}</span>
              </div>
            )}
            <div className="cd-row">
              <span>Tax</span>
              <span>{money(state.tax)}</span>
            </div>
            <div className="cd-total">
              <span>Total</span>
              <span data-testid="cd-total">{money(state.total)}</span>
            </div>
          </aside>
        </main>
      )}

      {state.mode === 'paid' && (
        <main className="cd-paid">
          <div className="cd-check">
            <Icon name="check" size={40} />
          </div>
          <h1>Thank you!</h1>
          <p>Receipt #{state.receiptNo}</p>
          <div className="cd-paid-grid">
            <div>
              <span>Total</span>
              <strong>{money(state.total)}</strong>
            </div>
            <div>
              <span>Received</span>
              <strong>{money(state.received)}</strong>
            </div>
            <div className="cd-change">
              <span>Change</span>
              <strong data-testid="cd-change">{money(state.change)}</strong>
            </div>
          </div>
          <p className="cd-methods">{state.methods.join(' + ')}</p>
        </main>
      )}
    </div>
  );
}
