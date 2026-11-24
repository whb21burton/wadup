import {useState} from 'react';
export default function EventQuality(){
 const [secret,setSecret]=useState('');
 const [data,setData]=useState(null);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 async function load(e){
  e.preventDefault();setBusy(true);setError('');setData(null);
  try{
   const r=await fetch('/api/admin/event-quality',{headers:{Authorization:'Bearer '+secret},cache:'no-store'});
   if(!r.ok)throw new Error('Diagnostics unavailable ('+r.status+')');
   setData(await r.json());
  }catch(e){setError(e.message);}finally{setBusy(false);setSecret('');}
 }
 return <main style={{maxWidth:1000,margin:'40px auto',padding:24,fontFamily:'system-ui'}}>
 <h1>Event Quality Center</h1><p>Official schedules and ticket verification diagnostics</p>
 <form onSubmit={load}><label>Administrator authorization <input type="password" autoComplete="off" value={secret} onChange={e=>setSecret(e.target.value)} required/></label> <button disabled={busy}>{busy?'Loading…':'Load diagnostics'}</button></form>
 {error&&<p role="alert">{error}</p>}
 {data&&<><section style={{display:'flex',flexWrap:'wrap',gap:16}}>{Object.entries({'Official performances':data.officialPerformances,'Ticketmaster records':data.ticketmasterRecords,...data.verification}).map(([label,value])=><div key={label} style={{border:'1px solid #aaa',borderRadius:8,padding:16,minWidth:140}}><small>{label}</small><h2>{value??'Unavailable'}</h2></div>)}</section>
 <h2>Venue synchronization</h2><table style={{width:'100%',textAlign:'left'}}><thead><tr>{['Venue','Status','Performances','Last checked','Reason'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{data.venues.map(v=><tr key={v.venue_id}><td>{v.venue_id}</td><td>{v.status}</td><td>{v.performance_count}</td><td>{v.checked_at}</td><td>{v.reason}</td></tr>)}</tbody></table>
 {data.errors.length>0&&<section><h2>Storage diagnostics</h2>{data.errors.map((e,i)=><p key={i}>{e.message}</p>)}</section>}</>}
 </main>;
}
