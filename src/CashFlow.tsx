import { useMemo, useState, useEffect, useRef } from 'react';
import { supabase } from './supabase';


type TxType = 'in' | 'out';
type Drag = { kind: 'tx' | 'pending'; id: string } | null;
interface Tx { id: string; date: string; desc: string; amount: number; type: TxType; cleared: boolean; }
interface Pending { id: string; desc: string; amount: number; supplier: string; type: TxType; }

const HK_HOLIDAYS: Record<string, string> = {
  '2026-01-01': '元旦',
  '2026-02-17': '農曆年初一',
  '2026-02-18': '農曆年初二',
  '2026-02-19': '農曆年初三',
  '2026-04-03': '耶穌受難節',
  '2026-04-04': '耶穌受難節翌日',
  '2026-04-06': '清明節翌日',
  '2026-04-07': '復活節星期一翌日',
  '2026-05-01': '勞動節',
  '2026-05-25': '佛誕翌日',
  '2026-06-19': '端午節',
  '2026-07-01': '香港特別行政區成立紀念日',
  '2026-09-26': '中秋節翌日',
  '2026-10-01': '國慶日',
  '2026-10-19': '重陽節翌日',
  '2026-12-25': '聖誕節',
  '2026-12-26': '聖誕節後第一個周日',
  '2027-01-01': '元旦',
  '2027-02-06': '農曆年初一',
  '2027-02-08': '農曆年初三',
  '2027-02-09': '農曆年初四',
  '2027-03-26': '耶穌受難節',
  '2027-03-27': '耶穌受難節翌日',
  '2027-03-29': '復活節星期一',
  '2027-04-05': '清明節',
  '2027-05-01': '勞動節',
  '2027-05-13': '佛誕',
  '2027-06-09': '端午節',
  '2027-07-01': '香港特別行政區成立紀念日',
  '2027-09-16': '中秋節翌日',
  '2027-10-01': '國慶日',
  '2027-10-08': '重陽節',
  '2027-12-25': '聖誕節',
  '2027-12-27': '聖誕節後第一個周日',
};


const OTHER_MONTH_BG = '#E0E0E0';
const HK = (n: number) => 'HK$' + n.toLocaleString('en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const uid = () => Math.random().toString(36).slice(2);
const WD = ['日', '一', '二', '三', '四', '五', '六'];
const isHoliday = (d: Date) => {
    const wd = d.getDay();
    if (wd === 0 || wd === 6) return true;
    return !!HK_HOLIDAYS[isoOf(d.getFullYear(), d.getMonth(), d.getDate())];
  };
  const prevWorkday = (d: Date) => { const r = new Date(d); while (isHoliday(r)) r.setDate(r.getDate() - 1); return r; };
  const nextWorkday = (d: Date) => { const r = new Date(d); while (isHoliday(r)) r.setDate(r.getDate() + 1); return r; };
  const adjustDate = (base: Date, cat: string) => {
    if (cat === 'util' || cat === 'income') return base;
    if (!isHoliday(base)) return base;
    if (cat === 'loan') return prevWorkday(base);
    const fwd = nextWorkday(base); // 人工
    const diff = Math.round((fwd.getTime() - base.getTime()) / 86400000);
    return diff >= 7 ? prevWorkday(base) : fwd;
  };
  

const load = <T,>(k: string, def: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; } };

export default function CashFlow() {
  const [tx, setTx] = useState<Tx[]>(() => load('cf_tx', []));
  const [pending, setPending] = useState<Pending[]>(() => load('cf_pending', []));
  const [opening, setOpening] = useState<number>(() => load('cf_opening', 0));
  const [safety, setSafety] = useState<number>(() => load('cf_safety', 50000));
  const [cursor, setCursor] = useState(new Date(2026, 6, 1));
  const [showTx, setShowTx] = useState(false);
  const [showRecur, setShowRecur] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const updateTx = (id: string, patch: Partial<Tx>) => setTx((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const moveToPending = (t: Tx) => {
    snapshot();
    setPending((prev) => [...prev, { id: uid(), desc: t.desc, amount: t.amount, supplier: '', type: t.type }]);
    setTx((prev) => prev.filter((x) => x.id !== t.id));
    setEditingId(null);
  };
  const [drag, setDrag] = useState<Drag>(null);
  const [overIso, setOverIso] = useState<string | null>(null);
  const [past, setPast] = useState<{ tx: Tx[]; pending: Pending[] }[]>([]);
  const [future, setFuture] = useState<{ tx: Tx[]; pending: Pending[] }[]>([]);
  const snapshot = () => { setPast((p) => [...p.slice(-29), { tx, pending }]); setFuture([]); };
  const loadedRef = useRef(false);
  const remoteRef = useRef(false);
  const lastSentRef = useRef('');


  // 開 app：從雲端讀一次 + 訂閱即時更新
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('app_state').select('*').eq('id', 1).single();
      if (data) {
        remoteRef.current = true;
        if (data.tx && data.tx.length) setTx(data.tx);
        if (data.pending && data.pending.length) setPending(data.pending);
        if (data.opening != null) setOpening(data.opening);

        setTimeout(() => { remoteRef.current = false; }, 0);
      }
      loadedRef.current = true;
    })();

    const ch = supabase.channel('app_state_rt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_state' }, (payload) => {
      const d: any = payload.new;
      const incoming = JSON.stringify({ tx: d.tx || [], pending: d.pending || [], opening: d.opening ?? 0 });
      // 同自己啱啱寫嘅一樣 → 係自己嘅 echo,唔好郁
      if (incoming === lastSentRef.current) return;
      remoteRef.current = true;
      if (d.tx?.length) setTx(d.tx);
      if (d.pending?.length) setPending(d.pending);
      if (d.opening != null) setOpening(d.opening);
      setTimeout(() => { remoteRef.current = false; }, 100);
    })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // 本機一改動 → 自動寫返雲端（0.5 秒 debounce）
  useEffect(() => {
    if (!loadedRef.current || remoteRef.current) return;
    const t = setTimeout(async () => {
      lastSentRef.current = JSON.stringify({ tx, pending, opening });
      const { error } = await supabase.from('app_state').update({ tx, pending, opening }).eq('id', 1);
      if (error) console.log('❌ 寫入失敗:', error.message);
    }, 800);


    return () => clearTimeout(t);
  }, [tx, pending, opening]);

  const undo = () => {
    if (past.length === 0) return;
    setFuture((f) => [{ tx, pending }, ...f]);
    const last = past[past.length - 1];
    setTx(last.tx); setPending(last.pending); setEditingId(null);
    setPast((p) => p.slice(0, -1));
  };
  const redo = () => {
    if (future.length === 0) return;
    setPast((p) => [...p, { tx, pending }]);
    const next = future[0];
    setTx(next.tx); setPending(next.pending); setEditingId(null);
    setFuture((f) => f.slice(1));
  };







  useEffect(() => { localStorage.setItem('cf_tx', JSON.stringify(tx)); }, [tx]);
  useEffect(() => { localStorage.setItem('cf_pending', JSON.stringify(pending)); }, [pending]);
  useEffect(() => { localStorage.setItem('cf_opening', JSON.stringify(opening)); }, [opening]);
  useEffect(() => { localStorage.setItem('cf_safety', JSON.stringify(safety)); }, [safety]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const monthFirst = isoOf(year, month, 1);
  const todayIso = new Date().toLocaleDateString('en-CA');  // "2026-07-21" 本地時間
  const monthOpening = opening + tx
    .filter((t) => t.date < monthFirst)
    .reduce((s, t) => s + (t.type === 'in' ? t.amount : -t.amount), 0);


  const monthTx = tx.filter((t) => t.date.startsWith(`${year}-${pad(month + 1)}`));
  const totalIn = monthTx.filter((t) => t.type === 'in').reduce((s, t) => s + t.amount, 0);
  const totalOut = monthTx.filter((t) => t.type === 'out').reduce((s, t) => s + t.amount, 0);
  const net = totalIn - totalOut;
  const ending = monthOpening + net;
  const pendingTotal = pending.reduce((s, p) => s + (p.type === 'out' ? p.amount : -p.amount), 0);

  const cells = useMemo(() => {
    const startDay = new Date(year, month, 1).getDay();
    const arr: { iso: string; day: number; inMonth: boolean; weekday: number }[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(year, month, 1 - startDay + i);
      arr.push({ iso: isoOf(d.getFullYear(), d.getMonth(), d.getDate()), day: d.getDate(), inMonth: d.getMonth() === month, weekday: d.getDay() });
    }
    return arr;
  }, [year, month]);

  const dailyBal = useMemo(() => {
    const map: Record<string, number> = {};
    cells.forEach((c) => {
      map[c.iso] = opening + tx
        .filter((t) => t.date <= c.iso)
        .reduce((s, t) => s + (t.type === 'in' ? t.amount : -t.amount), 0);
    });
    return map;
  }, [cells, tx, opening]);


  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const trend = useMemo(() => {
    const arr: { day: number; bal: number }[] = [];
    let bal = monthOpening;
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = isoOf(year, month, d);
      bal += tx.filter((t) => t.date === iso).reduce((s, t) => s + (t.type === 'in' ? t.amount : -t.amount), 0);
      arr.push({ day: d, bal });
    }
    return arr;
  }, [tx, monthOpening, year, month, daysInMonth]);

  const breachDays = trend.filter((p) => p.bal < safety).map((p) => `${p.day}/${month + 1}`);

  const toggle = (id: string) => setTx((prev) => prev.map((t) => (t.id === id ? { ...t, cleared: !t.cleared } : t)));

  const handleDrop = (iso: string) => {
    if (!drag) return;
    snapshot();
    if (drag.kind === 'tx') setTx((prev) => prev.map((t) => (t.id === drag.id ? { ...t, date: iso } : t)));
    else {
      const p = pending.find((x) => x.id === drag.id);
      if (p) {
        const label = [p.supplier, p.desc].filter(Boolean).join('｜');
        setTx((prev) => [...prev, { id: uid(), date: iso, desc: label, amount: p.amount, type: p.type, cleared: false }]);
        setPending((prev) => prev.filter((x) => x.id !== p.id));
      }
    }
    setDrag(null); setOverIso(null);
  };


  const box: any = { background: '#fff', borderRadius: 12, border: '1px solid #eee', padding: 12 };
  const inp: any = { width: '100%', padding: '6px 8px', border: '1px solid #ddd', borderRadius: 6, marginBottom: 6, boxSizing: 'border-box' };

  return (
    <div onClick={() => setEditingId(null)} style={{ minHeight: '100vh', background: '#faf5ff', fontFamily: 'system-ui', color: '#334155' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 24px', background: '#ADE0E0', borderBottom: '1px solid #eee' }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#7e22ce' }}>💊💰 PetElite Pharma Cash Flow Projection</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button onClick={() => setCursor(new Date(year, month - 1, 1))}>◀</button>
          <b>{year}年 {month + 1}月</b>
          <button onClick={() => setCursor(new Date(year, month + 1, 1))}>▶</button>
          <button onClick={undo} disabled={past.length === 0} style={{ background: past.length ? '#f59e0b' : '#e5e7eb', color: '#fff', border: 0, padding: '6px 12px', borderRadius: 8, cursor: past.length ? 'pointer' : 'not-allowed' }}>↶ 還原{past.length ? ` (${past.length})` : ''}</button>
          <button onClick={redo} disabled={future.length === 0} style={{ background: future.length ? '#0891b2' : '#e5e7eb', color: '#fff', border: 0, padding: '6px 12px', borderRadius: 8, cursor: future.length ? 'pointer' : 'not-allowed' }}>↷ 反還原{future.length ? ` (${future.length})` : ''}</button>
          <button onClick={() => setShowTx(true)} style={{ background: '#7e22ce', color: '#fff', border: 0, padding: '6px 12px', borderRadius: 8, cursor: 'pointer' }}>+ 新增項目</button>


        </div>
      </header>

      <div style={{ display: 'flex', gap: 8, padding: '10px 24px 0', alignItems: 'center', fontSize: 13, flexWrap: 'wrap' }}>
        安全線：<input type="number" value={safety || ''} placeholder="0"
          onChange={(e) => setSafety(e.target.value === '' ? 0 : Number(e.target.value))}
          style={{ ...inp, width: 160, marginBottom: 0, borderColor: '#ef4444' }} />
        <span style={{ display: 'flex', gap: 12, marginLeft: 'auto', fontSize: 11 }}>
          <span><span style={{ display: 'inline-block', width: 11, height: 11, background: '#eff6ff', border: '1px solid #cbd5e1', borderRadius: 2, marginRight: 3, verticalAlign: 'middle' }} />星期日</span>
          <span><span style={{ display: 'inline-block', width: 11, height: 11, background: '#fefce8', border: '1px solid #cbd5e1', borderRadius: 2, marginRight: 3, verticalAlign: 'middle' }} />公眾假期</span>
          <span><span style={{ display: 'inline-block', width: 11, height: 11, background: OTHER_MONTH_BG, borderRadius: 2, marginRight: 3, verticalAlign: 'middle' }} />其他月份</span>
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, padding: '12px 24px' }}>
        <Card label="總收入" val={HK(totalIn)} color="#059669" />
        <Card label="總支出" val={HK(totalOut)} color="#ef4444" />
        <Card label="淨現金" val={HK(net)} color={net >= 0 ? '#059669' : '#ef4444'} />
        <Card label="期末結餘" val={HK(ending)} color="#d97706" />
      </div>

      <div style={{ display: 'flex', gap: 12, padding: '0 24px 12px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 1, background: '#e9d5ff', borderRadius: '12px 12px 0 0', overflow: 'hidden' }}>
            {WD.map((w, i) => <div key={w} style={{ background: i === 0 ? '#dbeafe' : '#f5f3ff', textAlign: 'center', padding: 8, fontSize: 12, fontWeight: 600, color: i === 0 ? '#1d4ed8' : '#334155' }}>星期{w}</div>)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 1, background: '#e9d5ff' }}>
            {cells.map((c) => {
              const items = tx.filter((t) => t.date === c.iso);
              const dayIn = items.filter((t) => t.type === 'in').reduce((s, t) => s + t.amount, 0);
              const dayOut = items.filter((t) => t.type === 'out').reduce((s, t) => s + t.amount, 0);
              const bal = dailyBal[c.iso];
              const low = bal !== undefined && bal < safety;
              const isOver = overIso === c.iso;
              const holiday = HK_HOLIDAYS[c.iso];
              const isSunday = c.weekday === 0;
              const isToday = c.iso === todayIso;
              let bg = '#ffffff';
              if (holiday) bg = '#fefce8';
              else if (isSunday) bg = '#eff6ff';
              if (isOver) bg = '#ede9fe';
              if (!c.inMonth) bg = '#F0F0F0';
              return (
                <div key={c.iso}
                  onDragOver={(e) => { e.preventDefault(); setOverIso(c.iso); }}
                  onDragLeave={() => setOverIso(null)}
                  onDrop={() => handleDrop(c.iso)}
                  style={{ minHeight: 120, padding: 6, background: bg, display: 'flex', flexDirection: 'column', outline: isOver ? '2px dashed #7e22ce' : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 12, fontWeight: !c.inMonth ? 400 : (isSunday || holiday ? 700 : 500), color: !c.inMonth ? '#94a3b8' : holiday ? '#b45309' : isSunday ? '#1d4ed8' : '#64748b' }}>{c.day}</span>{isToday && <span style={{ marginLeft: 4, background: '#dc2626', color: '#fff', fontSize: 8, fontWeight: 700, borderRadius: 3, padding: '0 4px' }}>今日</span>}
                    {holiday && c.inMonth && <span style={{ fontSize: 9, color: '#92400e', fontWeight: 600, textAlign: 'right', maxWidth: 72, lineHeight: 1.1 }}>{holiday}</span>}
                  </div>
                  <div style={{ flex: 1, marginTop: 2 }}>
                    {items.map((t) => (
                      editingId === t.id ? (
                        <div key={t.id} onClick={(e) => e.stopPropagation()}
                          style={{ background: '#fff', border: '2px solid #7e22ce', borderRadius: 6, padding: 4, marginBottom: 3, fontSize: 10 }}>
                          <div style={{ display: 'flex', gap: 3, marginBottom: 3 }}>
                            <button onClick={() => updateTx(t.id, { type: 'out' })} style={{ flex: 1, padding: 2, borderRadius: 4, border: 0, cursor: 'pointer', fontSize: 9, background: t.type === 'out' ? '#ef4444' : '#eee', color: t.type === 'out' ? '#fff' : '#333' }}>支出</button>
                            <button onClick={() => updateTx(t.id, { type: 'in' })} style={{ flex: 1, padding: 2, borderRadius: 4, border: 0, cursor: 'pointer', fontSize: 9, background: t.type === 'in' ? '#10b981' : '#eee', color: t.type === 'in' ? '#fff' : '#333' }}>收入</button>
                          </div>
                          <input autoFocus type="number" value={t.amount} onChange={(e) => updateTx(t.id, { amount: Number(e.target.value) })} style={{ width: '100%', fontSize: 10, padding: '2px 4px', border: '1px solid #ddd', borderRadius: 4, marginBottom: 3, boxSizing: 'border-box' }} />
                          <input placeholder="描述" value={t.desc} onChange={(e) => updateTx(t.id, { desc: e.target.value })} style={{ width: '100%', fontSize: 10, padding: '2px 4px', border: '1px solid #ddd', borderRadius: 4, marginBottom: 3, boxSizing: 'border-box' }} />
                          <div style={{ display: 'flex', gap: 3 }}>
                            <button onClick={() => setEditingId(null)} style={{ flex: 1, padding: 3, borderRadius: 4, border: 0, cursor: 'pointer', fontSize: 9, background: '#7e22ce', color: '#fff' }}>✓ 完成</button>
                            <button onClick={() => moveToPending(t)} title="移回待安排" style={{ padding: '3px 5px', borderRadius: 4, border: '1px solid #ddd6fe', cursor: 'pointer', fontSize: 9, background: '#f5f3ff', color: '#7e22ce' }}>↩</button>
                            <button onClick={() => { snapshot(); setTx((prev) => prev.filter((x) => x.id !== t.id)); setEditingId(null); }} style={{ padding: '3px 5px', borderRadius: 4, border: 0, cursor: 'pointer', fontSize: 9, background: '#fee2e2', color: '#dc2626' }}>✕</button>
                          </div>
                        </div>
                      ) : (
                        <div key={t.id} draggable
                          onDragStart={() => setDrag({ kind: 'tx', id: t.id })}
                          onClick={(e) => { e.stopPropagation(); setEditingId(t.id); }}
                          title="撳一下直接修改"
                          style={{ display: 'flex', alignItems: 'flex-start', gap: 2, fontSize: 10, cursor: 'pointer', background: t.type === 'in' ? '#dcfce7' : '#fee2e2', borderLeft: `3px solid ${t.type === 'in' ? '#16a34a' : '#dc2626'}`, borderRadius: 4, padding: '2px 3px', marginBottom: 2, opacity: t.cleared ? 0.4 : 1 }}>
                          <span onClick={(e) => { e.stopPropagation(); toggle(t.id); }} style={{ cursor: 'pointer' }}>{t.cleared ? '✅' : '⬜'}</span>
                          <div style={{ flex: 1, lineHeight: 1.3, textDecoration: t.cleared ? 'line-through' : 'none' }}>
                            <div style={{ fontWeight: 700, color: t.type === 'in' ? '#15803d' : '#dc2626' }}>{t.type === 'out' ? '−' : '+'}{HK(t.amount)}</div>
                            {t.desc && <div style={{ color: '#475569' }}>{t.desc}</div>}
                          </div>

                        </div>
                      )
                    ))}
                  </div>
                  <div style={{ fontSize: 10, borderTop: '1px solid rgba(0,0,0,.08)', paddingTop: 2, marginTop: 2 }}>
                    {dayIn > 0 && <div style={{ color: '#16a34a', textAlign: 'right', fontWeight: 600 }}>入 +{HK(dayIn)}</div>}
                    {dayOut > 0 && <div style={{ color: '#dc2626', textAlign: 'right', fontWeight: 600 }}>出 −{HK(dayOut)}</div>}
                    {bal !== undefined && (
                      <div style={{ textAlign: 'right', fontWeight: 700, fontSize: 11, color: '#2563eb', background: '#dbeafe', borderRadius: 3, padding: '1px 3px' }}>
                        結 {HK(bal)}
                      </div>
                    )}

                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <aside style={{ width: 260, ...box, height: 'fit-content' }}>
          <div style={{ fontWeight: 600, color: '#7e22ce', marginBottom: 8 }}>📌 待安排項目</div>
          <PendingForm onAdd={(p) => setPending((prev) => [...prev, { ...p, id: uid() }])} inp={inp} />
          {pending.map((p) => (
            <div key={p.id} draggable onDragStart={() => setDrag({ kind: 'pending', id: p.id })} onDragEnd={() => { setDrag(null); setOverIso(null); }}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 4px', borderBottom: '1px solid #f1f5f9', fontSize: 12, cursor: 'grab', background: '#faf5ff', borderRadius: 6, marginBottom: 3 }}>
              <div>
                <div style={{ color: p.type === 'in' ? '#15803d' : '#dc2626', fontWeight: 600 }}>⠿ {p.type === 'out' ? '−' : '+'}{HK(p.amount)}</div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>{[p.supplier, p.desc].filter(Boolean).join(' · ') || '未填描述'}</div>
              </div>
              <button onClick={() => setPending((prev) => prev.filter((x) => x.id !== p.id))} style={{ fontSize: 10, background: '#f1f5f9', color: '#64748b', border: 0, padding: '4px 8px', borderRadius: 6, cursor: 'pointer' }}>✕</button>
            </div>
          ))}
          
          <button onClick={() => setShowRecur(true)} style={{ width: '100%', background: '#0891b2', color: '#fff', border: 0, padding: 8, borderRadius: 6, cursor: 'pointer', marginTop: 4 }}>🔁 設定固定支出/收入</button>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: pendingTotal >= 0 ? '#15803d' : '#dc2626', marginTop: 8, paddingTop: 8, borderTop: '1px solid #e2e8f0' }}>
            <span>總待付款</span><span>{pendingTotal >= 0 ? '+' : '−'}{HK(Math.abs(pendingTotal))}</span>
          </div>
          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 6 }}>👆 拖去月曆任何一日就落實</div>
          <div
            onDragOver={(e) => { e.preventDefault(); setOverIso('__PENDING__'); }}
            onDragLeave={() => setOverIso(null)}
            onDrop={() => {
              if (drag?.kind === 'tx') {
                const t = tx.find((x) => x.id === drag.id);
                if (t) {
                  setPending((prev) => [...prev, { id: uid(), desc: t.desc, amount: t.amount, supplier: '', type: t.type }]);
                  setTx((prev) => prev.filter((x) => x.id !== t.id));
                }
              }
              setDrag(null); setOverIso(null);
            }}
            style={{ marginTop: 10, padding: '16px 8px', borderRadius: 8, textAlign: 'center', fontSize: 12, border: `2px dashed ${overIso === '__PENDING__' ? '#7e22ce' : '#cbd5e1'}`, background: overIso === '__PENDING__' ? '#ede9fe' : '#f8fafc', color: overIso === '__PENDING__' ? '#7e22ce' : '#94a3b8' }}>
            ↩ 將月曆項目拖返呢度
          </div>
        </aside>
      </div>

      <div style={{ padding: '0 24px 12px' }}>
        <div style={{ ...box }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontWeight: 700, color: '#7e22ce' }}>📈 現金結餘走勢</span>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>安全線 {HK(safety)}</span>
          </div>
          <TrendChart trend={trend} safety={safety} month={month + 1} />
        </div>
      </div>

      <div style={{ padding: '0 24px 24px' }}>
        <div style={{ ...box, borderColor: breachDays.length ? '#fca5a5' : '#bbf7d0', background: breachDays.length ? '#fef2f2' : '#f0fdf4' }}>
          {breachDays.length ? (
            <>
              <div style={{ fontWeight: 700, color: '#dc2626' }}>現金流警告</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>預計現金結餘將於 <b style={{ color: '#dc2626' }}>{breachDays.slice(0, 6).join(', ')}{breachDays.length > 6 ? ` 等${breachDays.length}日` : ''}</b> 跌穿安全線 {HK(safety)}</div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 700, color: '#15803d' }}>現金流健康</div>
              <div style={{ fontSize: 13, marginTop: 4, color: '#475569' }}>本月預計結餘全程高於安全線 {HK(safety)}</div>
            </>
          )}
        </div>
      </div>

      {showRecur && <RecurModal inp={inp} defaultY={year} defaultM={month}
        onClose={() => setShowRecur(false)}
        onGenerate={(cfg: any) => {
          snapshot();
          const items: Tx[] = [];
          if (cfg.mode === 'weekly') {
            const [sy, sm, sd] = cfg.startDate.split('-').map(Number);
            const [ey, em, ed] = cfg.endDate.split('-').map(Number);
            const end = new Date(ey, em - 1, ed);
            const d = new Date(sy, sm - 1, sd);
            while (d <= end) {
              if (cfg.weekdays.includes(d.getDay())) {
                let target = new Date(d);
                if (HK_HOLIDAYS[isoOf(target.getFullYear(), target.getMonth(), target.getDate())]) target = nextWorkday(target);
                items.push({ id: uid(), date: isoOf(target.getFullYear(), target.getMonth(), target.getDate()), desc: cfg.name, amount: cfg.amount, type: 'in', cleared: false });
              }
              d.setDate(d.getDate() + 1);
            }
          } else {
            for (let i = 0; i < cfg.periods; i++) {
              const dd = new Date(cfg.startY, cfg.startM + i, 1);
              const yy = dd.getFullYear(), mm = dd.getMonth();
              const lastDay = new Date(yy, mm + 1, 0).getDate();
              const base = new Date(yy, mm, Math.min(cfg.day, lastDay));
              const target = adjustDate(base, cfg.cat);
              items.push({ id: uid(), date: isoOf(target.getFullYear(), target.getMonth(), target.getDate()), desc: cfg.name, amount: cfg.amount, type: cfg.type, cleared: false });
            }
          }
          setTx((prev) => [...prev, ...items]);
          setShowRecur(false);
        }} />}

  
  

{showTx && <TxModal onClose={() => setShowTx(false)} onAdd={(t) => { snapshot(); setTx((prev) => [...prev, { ...t, id: uid() }]); setShowTx(false); }} defaultDate={isoOf(year, month, 1)} inp={inp} />}
    </div>
  );
}

function TrendChart({ trend, safety, month }: { trend: { day: number; bal: number }[]; safety: number; month: number }) {
  const W = 1200, H = 220, PL = 90, PR = 40, PT = 20, PB = 30;
  if (trend.length < 2) return null;
  const bals = trend.map((t) => t.bal);
  const min = Math.min(safety, 0, ...bals);
  const max = Math.max(safety, ...bals);
  const range = max - min || 1;
  const x = (i: number) => PL + (i / (trend.length - 1)) * (W - PL - PR);
  const y = (v: number) => H - PB - ((v - min) / range) * (H - PT - PB);
  const ticks: number[] = [];
  for (let i = 0; i <= 5; i++) ticks.push(min + (range / 5) * i);
  const fmtK = (n: number) => { const s = n < 0 ? '−' : ''; const a = Math.abs(n); return a >= 1000 ? `${s}HK$${(a / 1000).toFixed(0)}K` : `${s}HK$${a.toFixed(0)}`; };
  const pts = trend.map((t, i) => [x(i), y(t.bal)] as [number, number]);
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2, tn = 0.16;
    d += ` C ${p1[0] + (p2[0] - p0[0]) * tn},${p1[1] + (p2[1] - p0[1]) * tn} ${p2[0] - (p3[0] - p1[0]) * tn},${p2[1] - (p3[1] - p1[1]) * tn} ${p2[0]},${p2[1]}`;
  }
  const area = `${d} L ${pts[pts.length - 1][0]},${H - PB} L ${pts[0][0]},${H - PB} Z`;
  const safetyY = y(safety);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 220 }}>
      <defs><linearGradient id="cfA" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity="0.22" /><stop offset="100%" stopColor="#3b82f6" stopOpacity="0" /></linearGradient></defs>
      {ticks.map((v, i) => (<g key={i}><line x1={PL} y1={y(v)} x2={W - PR} y2={y(v)} stroke="#f1f5f9" strokeWidth={1} /><text x={PL - 8} y={y(v) + 3} fontSize={10} fill="#94a3b8" textAnchor="end">{fmtK(v)}</text></g>))}
      <line x1={PL} y1={safetyY} x2={W - PR} y2={safetyY} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="6 4" />
      <text x={W - PR} y={safetyY - 5} fontSize={11} fill="#ef4444" textAnchor="end" fontWeight={600}>安全線 {fmtK(safety)}</text>
      <path d={area} fill="url(#cfA)" />
      <path d={d} fill="none" stroke="#3b82f6" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {trend.map((t, i) => (<circle key={i} cx={x(i)} cy={y(t.bal)} r={t.bal < safety ? 4 : 2.5} fill={t.bal < safety ? '#dc2626' : '#3b82f6'} stroke="#fff" strokeWidth={t.bal < safety ? 1.5 : 0} />))}
      {trend.map((t, i) => (i % 2 === 0 || i === trend.length - 1) && (<text key={`x${i}`} x={x(i)} y={H - 10} fontSize={9} fill="#94a3b8" textAnchor="middle">{t.day}/{month}</text>))}
    </svg>
  );
}

function Card({ label, val, color }: { label: string; val: string; color: string }) {
  return <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #eee', padding: 12, textAlign: 'center' }}>
    <div style={{ fontSize: 12, color: '#94a3b8' }}>{label}</div>
    <div style={{ fontSize: 18, fontWeight: 700, color }}>{val}</div>
  </div>;
}

function PendingForm({ onAdd, inp }: { onAdd: (p: { desc: string; amount: number; supplier: string; type: TxType }) => void; inp: any }) {
  const [amount, setAmount] = useState(''); const [supplier, setSupplier] = useState(''); const [desc, setDesc] = useState(''); const [type, setType] = useState<TxType>('out');
  return <div style={{ marginBottom: 10 }}>
    <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
      <button onClick={() => setType('out')} style={{ flex: 1, padding: 6, borderRadius: 6, border: 0, cursor: 'pointer', fontSize: 12, background: type === 'out' ? '#ef4444' : '#eee', color: type === 'out' ? '#fff' : '#333' }}>💸 支出</button>
      <button onClick={() => setType('in')} style={{ flex: 1, padding: 6, borderRadius: 6, border: 0, cursor: 'pointer', fontSize: 12, background: type === 'in' ? '#10b981' : '#eee', color: type === 'in' ? '#fff' : '#333' }}>💰 收入</button>
    </div>

    <input placeholder="供應商 / 來源" value={supplier} onChange={(e) => setSupplier(e.target.value)} style={inp} />
    <input placeholder="金額" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={inp} />
  <input placeholder="描述（可留空）" value={desc} onChange={(e) => setDesc(e.target.value)} style={inp} />

    <button onClick={() => { if (amount) { onAdd({ desc, amount: Number(amount), supplier, type }); setAmount(''); setSupplier(''); setDesc(''); } }} style={{ width: '100%', background: '#7e22ce', color: '#fff', border: 0, padding: 8, borderRadius: 6, cursor: 'pointer' }}>新增待安排</button>
  </div>;
}

function TxModal({ onClose, onAdd, defaultDate, inp }: { onClose: () => void; onAdd: (t: Omit<Tx, 'id'>) => void; defaultDate: string; inp: any }) {
  const [date, setDate] = useState(defaultDate); const [desc, setDesc] = useState(''); const [amount, setAmount] = useState(''); const [type, setType] = useState<TxType>('out');
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
    <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 16, width: 300 }}>
      <h3 style={{ color: '#7e22ce', marginTop: 0 }}>+ 新增項目</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button onClick={() => setType('out')} style={{ flex: 1, padding: 8, borderRadius: 6, border: 0, cursor: 'pointer', background: type === 'out' ? '#ef4444' : '#eee', color: type === 'out' ? '#fff' : '#333' }}>💸 支出</button>
        <button onClick={() => setType('in')} style={{ flex: 1, padding: 8, borderRadius: 6, border: 0, cursor: 'pointer', background: type === 'in' ? '#10b981' : '#eee', color: type === 'in' ? '#fff' : '#333' }}>💰 收入</button>
      </div>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inp} />
      <input placeholder="描述（可留空）" value={desc} onChange={(e) => setDesc(e.target.value)} style={inp} />
      <input placeholder="金額" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={inp} />
      <button onClick={() => amount && onAdd({ date, desc, amount: Number(amount), type, cleared: false })} style={{ width: '100%', background: '#7e22ce', color: '#fff', border: 0, padding: 10, borderRadius: 8, cursor: 'pointer' }}>加入</button>
    </div>
  </div>;
}

function RecurModal({ onClose, onGenerate, defaultY, defaultM, inp }: {
  onClose: () => void;
  onGenerate: (cfg: any) => void;
  defaultY: number; defaultM: number; inp: any;
}) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<TxType>('out');
  // 支出（每月）用
  const [day, setDay] = useState('15');
  const [cat, setCat] = useState('loan');
  const [periods, setPeriods] = useState('12');
  const [startM, setStartM] = useState(defaultM);
  const [startY, setStartY] = useState(defaultY);
  // 收入（每週）用
  const [weekdays, setWeekdays] = useState<number[]>([5]);
  const toggleWd = (v: number) => setWeekdays((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]);
  const [startDate, setStartDate] = useState(isoOf(defaultY, defaultM, 1));
  const [endDate, setEndDate] = useState(isoOf(defaultY, 11, 31));

  const cats = [
    { key: 'loan', label: '🏦 貸款', desc: '撞假期/週末 → 提前到之前工作日' },
    { key: 'util', label: '⚡ 恆常', desc: '水電等，照原日不調整' },
    { key: 'salary', label: '👥 人工', desc: '順延到下個工作日；若順延≥7日則提前' },
  ];
  const wds = [{ v: 1, l: '一' }, { v: 2, l: '二' }, { v: 3, l: '三' }, { v: 4, l: '四' }, { v: 5, l: '五' }, { v: 6, l: '六' }, { v: 0, l: '日' }];

  const weeklyCount = () => {
    if (!startDate || !endDate || weekdays.length === 0) return 0;
    const [sy, sm, sd] = startDate.split('-').map(Number);
    const [ey, em, ed] = endDate.split('-').map(Number);
    const end = new Date(ey, em - 1, ed); const d = new Date(sy, sm - 1, sd);
    let n = 0;
    while (d <= end) { if (weekdays.includes(d.getDay())) n++; d.setDate(d.getDate() + 1); }
    return n;
  };


  const isIn = type === 'in';
  const canGen = isIn ? (amount && startDate && endDate && weekdays.length > 0) : (amount && periods);
  const preview = isIn
  ? (amount ? `逢星期${weekdays.slice().sort((a,b)=>(a===0?7:a)-(b===0?7:b)).map((v) => wds.find((w) => w.v === v)?.l).join('、')}，共 ${weeklyCount()} 次，每次 ${HK(Number(amount))}` : '')
    : (amount && periods ? `共 ${periods} 期，每期 ${HK(Number(amount))}，總額 ${HK(Number(amount) * Number(periods))}` : '');

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 16, width: 340 }}>
        <h3 style={{ color: '#0891b2', marginTop: 0 }}>🔁 設定固定支出/收入</h3>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button onClick={() => setType('out')} style={{ flex: 1, padding: 8, borderRadius: 6, border: 0, cursor: 'pointer', background: type === 'out' ? '#ef4444' : '#eee', color: type === 'out' ? '#fff' : '#333' }}>💸 支出</button>
          <button onClick={() => setType('in')} style={{ flex: 1, padding: 8, borderRadius: 6, border: 0, cursor: 'pointer', background: type === 'in' ? '#10b981' : '#eee', color: type === 'in' ? '#fff' : '#333' }}>💰 收入</button>
        </div>
        <input placeholder={isIn ? '名稱（例：Kpay收入）' : '名稱（例：貸款）'} value={name} onChange={(e) => setName(e.target.value)} style={inp} />
        <input placeholder={isIn ? '每次金額' : '每期金額'} type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={inp} />

        {isIn ? (
          <>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>逢星期幾</div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {wds.map((w) => {
                const on = weekdays.includes(w.v);
                return (
                  <button key={w.v} onClick={() => toggleWd(w.v)} style={{ flex: 1, padding: '6px 0', borderRadius: 6, border: on ? '2px solid #10b981' : '1px solid #ddd', background: on ? '#ecfdf5' : '#fff', color: on ? '#059669' : '#64748b', cursor: 'pointer', fontSize: 12, fontWeight: on ? 700 : 400 }}>{w.l}</button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>開始日期</div>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inp} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>結束日期</div>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={inp} />
              </div>
            </div>
            <div style={{ fontSize: 10, color: '#059669', marginBottom: 8 }}>撞公眾假期 → 順延到下一個工作日</div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>每月幾號</div>
                <input type="number" min={1} max={31} value={day} onChange={(e) => setDay(e.target.value)} style={inp} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>供款期數</div>
                <input type="number" min={1} value={periods} onChange={(e) => setPeriods(e.target.value)} style={inp} />
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>由邊個月開始</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input type="number" value={startY} onChange={(e) => setStartY(Number(e.target.value))} style={{ ...inp, flex: 1, marginBottom: 0 }} />
              <select value={startM} onChange={(e) => setStartM(Number(e.target.value))} style={{ ...inp, flex: 1, marginBottom: 0 }}>
                {Array.from({ length: 12 }).map((_, i) => <option key={i} value={i}>{i + 1}月</option>)}
              </select>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>支出類別（決定撞假期點調整）</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {cats.map((c) => (
                <button key={c.key} onClick={() => setCat(c.key)} style={{ flex: 1, padding: '6px 4px', borderRadius: 6, border: cat === c.key ? '2px solid #0891b2' : '1px solid #ddd', background: cat === c.key ? '#ecfeff' : '#fff', color: cat === c.key ? '#0891b2' : '#64748b', cursor: 'pointer', fontSize: 11, fontWeight: cat === c.key ? 700 : 400 }}>{c.label}</button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: '#0891b2', marginTop: 4, marginBottom: 8 }}>{cats.find((c) => c.key === cat)?.desc}</div>
          </>
        )}

        {preview && <div style={{ fontSize: 12, color: '#0891b2', background: '#ecfeff', padding: 8, borderRadius: 6, marginBottom: 8 }}>{preview}</div>}
        <button disabled={!canGen}
          onClick={() => {
            if (isIn) onGenerate({ mode: 'weekly', name: name || '固定收入', amount: Number(amount), weekdays, startDate, endDate });
            else onGenerate({ mode: 'monthly', name: name || '固定支出', amount: Number(amount), day: Number(day) || 1, type, periods: Number(periods), startY, startM, cat });
          }}
          style={{ width: '100%', background: !canGen ? '#cbd5e1' : '#0891b2', color: '#fff', border: 0, padding: 10, borderRadius: 8, cursor: !canGen ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
          {!amount ? '請先填金額' : isIn ? `生成 ${weeklyCount()} 次` : `生成 ${periods || 0} 期`}
        </button>
      </div>
    </div>
  );
}