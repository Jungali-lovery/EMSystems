import { useMemo } from 'react';
import { formatMoney } from '../../api-client.js';
import { Button } from '@/components/ui/button.jsx';

const statusLabels = {
  completed: 'Hoàn tất',
  partially_returned: 'Trả một phần',
  returned: 'Đã hoàn trả',
  draft: 'Chờ thanh toán',
  cancelled: 'Đã hủy',
};

// Grid chỉ được tải khi nhân viên mở POS; storefront không nhận bundle Telerik.
export default function SalesHistoryGrid({ sales, canProcessReturns, onReturn }) {
  const gridSales = useMemo(() => sales.map((sale) => ({
    ...sale,
    createdAtLabel: new Date(sale.createdAt).toLocaleString('vi-VN'),
    customerLabel: sale.customerName || 'Khách lẻ',
    totalAmountLabel: formatMoney(Number(sale.totalAmount)),
    statusLabel: statusLabels[sale.status] || sale.status,
  })), [sales]);

  function exportCsv() {
    const columns = ['Mã hóa đơn', 'Thời gian', 'Khách hàng', 'Chi nhánh', 'Thu ngân', 'Tổng tiền', 'Trạng thái'];
    const rows = gridSales.map((sale) => [sale.invoiceNo, sale.createdAtLabel, sale.customerLabel, sale.branchName, sale.cashierName, sale.totalAmountLabel, sale.statusLabel]);
    const csv = [columns, ...rows].map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    link.download = 'emsystems-pos-hoa-don.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <div className="sales-history-grid-wrap">
      <div className="sales-history-toolbar"><Button variant="outline" size="sm" onClick={exportCsv}><i className="bi bi-filetype-csv" aria-hidden="true" /> Xuất CSV trang hiện tại</Button></div>
      <div className="sales-history-table-scroll"><table className="sales-history-table"><thead><tr><th>Mã hóa đơn</th><th>Thời gian</th><th>Khách hàng</th><th>Chi nhánh</th><th>Thu ngân</th><th>Tổng tiền</th><th>Trạng thái</th>{canProcessReturns && <th>Thao tác</th>}</tr></thead><tbody>{gridSales.map((sale) => (
        <tr key={sale.id}><td>{sale.invoiceNo}</td><td>{sale.createdAtLabel}</td><td>{sale.customerLabel}</td><td>{sale.branchName}</td><td>{sale.cashierName}</td><td>{sale.totalAmountLabel}</td><td>{sale.statusLabel}</td>{canProcessReturns && <td>
        <Button
          variant="outline"
          size="sm"
          className="sales-return-button"
          disabled={!['completed', 'partially_returned'].includes(sale.status)}
          onClick={() => onReturn(sale)}
          aria-label={`Đổi trả hóa đơn ${sale.invoiceNo}`}
        >
          Đổi trả
        </Button>
      </td>}</tr>))}</tbody></table></div>
    </div>
  );
}
