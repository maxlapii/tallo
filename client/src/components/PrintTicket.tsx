import type { ReceiptPayload, TicketPayload } from '../api/types';
import { formatDateTime, money } from '../utils/format';

/** Renders a print job payload as a paper ticket (also used as the print area). */
export function PrintTicket({ payload }: { payload: TicketPayload | ReceiptPayload }) {
  if (payload.kind === 'TICKET') {
    return (
      <div className="receipt ticket" data-testid="ticket">
        <div className="r-center r-title">{payload.area.toUpperCase()}</div>
        {payload.reprint && <div className="r-center">** REPRINT **</div>}
        <div className="r-line">
          <span>Order #{payload.receiptNo}</span>
          <span>{formatDateTime(payload.createdAt)}</span>
        </div>
        {payload.customerName && <div>For: {payload.customerName}</div>}
        <div className="r-hr" />
        <div className="ticket-items">
          {payload.items.map((i, idx) => (
            <div className="ticket-item" key={idx}>
              <span className="ticket-qty">{i.quantity}×</span>
              <span>{i.name}</span>
            </div>
          ))}
        </div>
        {payload.note && (
          <>
            <div className="r-hr" />
            <div>Note: {payload.note}</div>
          </>
        )}
        <div className="r-hr" />
        <div className="r-line">
          <span>Server</span>
          <span>{payload.cashier}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="receipt" data-testid="ticket">
      <div className="r-center r-title">{payload.storeName}</div>
      {payload.reprint && <div className="r-center">** REPRINT **</div>}
      <div className="r-hr" />
      <div className="r-line">
        <span>Receipt #</span>
        <span>{payload.receiptNo}</span>
      </div>
      <div className="r-line">
        <span>Date</span>
        <span>{formatDateTime(payload.createdAt)}</span>
      </div>
      <div className="r-line">
        <span>Cashier</span>
        <span>{payload.cashier}</span>
      </div>
      <div className="r-hr" />
      <table className="r-items">
        <tbody>
          {payload.items.map((i, idx) => (
            <tr key={idx}>
              <td>{i.name}</td>
              <td className="num">{i.quantity}</td>
              <td className="num">{i.unitPrice.toFixed(2)}</td>
              <td className="num">{i.total.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="r-hr" />
      <div className="r-line">
        <span>Subtotal</span>
        <span>{money(payload.subtotal)}</span>
      </div>
      {payload.discount > 0 && (
        <div className="r-line">
          <span>Discount</span>
          <span>-{money(payload.discount)}</span>
        </div>
      )}
      <div className="r-line">
        <span>Tax</span>
        <span>{money(payload.tax)}</span>
      </div>
      <div className="r-line r-total">
        <span>TOTAL</span>
        <span>{money(payload.total)}</span>
      </div>
      <div className="r-hr" />
      {payload.payments.map((p, idx) => (
        <div className="r-line" key={idx}>
          <span>{p.method}</span>
          <span>{money(p.amount)}</span>
        </div>
      ))}
      <div className="r-line">
        <span>Change</span>
        <span>{money(payload.change)}</span>
      </div>
      <div className="r-hr" />
      <div className="r-center">Thank you</div>
    </div>
  );
}
