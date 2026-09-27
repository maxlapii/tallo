import type { Receipt } from '../api/types';
import { formatDateTime, money } from '../utils/format';

export function ReceiptView({ receipt }: { receipt: Receipt }) {
  return (
    <div className="receipt print-area" data-testid="receipt">
      <div className="r-center r-title">{receipt.storeName}</div>
      <div className="r-hr" />
      <div className="r-line">
        <span>Receipt #</span>
        <span data-testid="receipt-no">{receipt.receiptNo}</span>
      </div>
      <div className="r-line">
        <span>Date</span>
        <span>{formatDateTime(receipt.date)}</span>
      </div>
      <div className="r-line">
        <span>Cashier</span>
        <span>{receipt.cashier}</span>
      </div>
      {receipt.customerName && (
        <div className="r-line">
          <span>Customer</span>
          <span>{receipt.customerName}</span>
        </div>
      )}
      <div className="r-hr" />
      <table className="r-items">
        <thead>
          <tr>
            <td>Item</td>
            <td className="num">Qty</td>
            <td className="num">Price</td>
            <td className="num">Total</td>
          </tr>
        </thead>
        <tbody>
          {receipt.items.map((i, idx) => (
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
        <span>{money(receipt.subtotal)}</span>
      </div>
      {receipt.discount > 0 && (
        <div className="r-line">
          <span>Discount</span>
          <span>-{money(receipt.discount)}</span>
        </div>
      )}
      <div className="r-line">
        <span>Tax</span>
        <span>{money(receipt.tax)}</span>
      </div>
      <div className="r-line r-total">
        <span>TOTAL</span>
        <span data-testid="receipt-total">{money(receipt.total)}</span>
      </div>
      <div className="r-hr" />
      {receipt.payments.map((p, idx) => (
        <div className="r-line" key={idx}>
          <span>
            {p.method}
            {p.referenceNo ? ` (${p.referenceNo})` : ''}
          </span>
          <span>{money(p.amount)}</span>
        </div>
      ))}
      <div className="r-line">
        <span>Received</span>
        <span>{money(receipt.received)}</span>
      </div>
      <div className="r-line">
        <span>Change</span>
        <span data-testid="receipt-change">{money(receipt.change)}</span>
      </div>
      {receipt.refundedTotal > 0 && (
        <div className="r-line">
          <span>Refunded</span>
          <span>-{money(receipt.refundedTotal)}</span>
        </div>
      )}
      <div className="r-hr" />
      <div className="r-center">Thank you</div>
    </div>
  );
}
