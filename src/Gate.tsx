import { useState } from 'react';

// 人員名單:username → password（自行增減）
const USERS: Record<string, string> = {
    thomas: 'Thomas1234',
    louis:  'Louis1234',
    julia: 'Julia1234',
    renee:  'Renee1234',
  };

export default function Gate({ children }: { children: React.ReactNode }) {
  const [ok, setOk] = useState(() => !!sessionStorage.getItem('user'));
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState(false);

  if (ok) return <>{children}</>;

  const login = () => {
    if (USERS[u.trim().toLowerCase()] === p) {
      sessionStorage.setItem('user', u.trim().toLowerCase());
      setOk(true);
    } else { setErr(true); }
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
      justifyContent:'center', height:'100vh', gap:10, fontFamily:'sans-serif' }}>
      <h2>PetElite Pharma Cash Flow</h2>
      <input placeholder="用戶名" value={u}
        onChange={e=>{setU(e.target.value);setErr(false);}}
        style={{padding:8,fontSize:16,border:'1px solid #ccc',borderRadius:6}} />
      <input placeholder="密碼" type="password" value={p}
        onChange={e=>{setP(e.target.value);setErr(false);}}
        onKeyDown={e=>{if(e.key==='Enter')login();}}
        style={{padding:8,fontSize:16,border:'1px solid #ccc',borderRadius:6}} />
      <button onClick={login}
        style={{padding:'8px 24px',fontSize:16,background:'#2563eb',
          color:'#fff',border:'none',borderRadius:6,cursor:'pointer'}}>進入</button>
      {err && <p style={{color:'red'}}>用戶名或密碼錯誤</p>}
    </div>
  );
}
