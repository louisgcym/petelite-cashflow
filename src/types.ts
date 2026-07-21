export type TxType = 'in' | 'out';
export type Priority = 'urgent' | 'normal' | 'flexible';

export interface Tx {
  id: string;
  date: string;        // '2026-07-16'
  desc: string;
  amount: number;      // 正數，type 決定加減
  type: TxType;
  cleared: boolean;    // 綠色剔
}

export interface Pending {
  id: string;
  desc: string;
  amount: number;
  type: TxType;
  supplier: string;
  priority: Priority;
  note?: string;
}
