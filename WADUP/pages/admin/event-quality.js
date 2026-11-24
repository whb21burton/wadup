import {useState} from 'react';
export default function EventQuality(){
 const [secret,setSecret]=useState('');
 const [data,setData]=useState(null);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [runResult,setRunResult]=useState(null);
 async function run(e){
  e.preventDefault();const action=e.nativeEvent.submitter?.value;
  if(!['sync-venue-schedules','verify-event-tickets'].includes(action))return;
  setBusy(true);setError('');setRunResult(null);
  try{const r=await fetch('/api/cron/'+action,{method:'POST',headers:{Authorization:'Bearer '+secret.trim()},cache:'no-store'});const body=await r.json().catch(()=>null);if(!r.ok)throw new Error(body?.error||('Worker returned '+r.status));setRunResult(body);}catch(e){setError(e.message);}finally{setBusy(false);setSecret('');}
 }
 async function load(e){
  e.preventDefault();setBusy(true);setError('');setData(null);
  try{
   const r=await fetch('/api/admin/event-quality',{headers:{Authorization:'Bearer '+secret.trim()},cache:'no-store'});
   if(!r.ok)throw new Error('Diagnostics unavailable ('+r.status+')');
   setData(await r.json());
  }catch(e){setError(e.message);}finally{setBusy(false);setSecret('');}
 }
 return <main style={{maxWidth:1000,margin:'40px auto',padding:24,fontFamily:'system-ui',color:'#f1f5f9',background:'#151b25',borderRadius:12,lineHeight:1.6}}>
 <h1>Event Quality Center</h1><p>Official schedules and ticket verification diagnostics</p>
 <form onSubmit={e=>e.nativeEvent.submitter?.value==='diagnostics'||!e.nativeEvent.submitter?.value?load(e):run(e)}><label>Administrator authorization <input type="password" autoComplete="off" style={{padding:8,margin:8}} value={secret} onChange={e=>setSecret(e.target.value)} required/></label> <button value="diagnostics" disabled={busy}>{busy?'Working…':'Load diagnostics'}</button> <button value="sync-venue-schedules" disabled={busy}>Sync official schedules</button> <button value="verify-event-tickets" disabled={busy}>Verify ticket batch</button></form>
 {error&&<p role="alert">{error}</p>}
 {runResult&&<section><h2>Worker result</h2><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify(runResult,null,2)}</pre></section>}
 {data&&<><section style={{display:'flex',flexWrap:'wrap',gap:16}}>{Object.entries({'Official performances':data.officialPerformances,'Ticketmaster records':data.ticketmasterRecords,...data.verification}).map(([label,value])=><div key={label} style={{border:'1px solid #aaa',borderRadius:8,padding:16,minWidth:140}}><small>{label}</small><h2>{value??'Unavailable'}</h2></div>)}</section>
 <h2>Venue synchronization</h2><table style={{width:'100%',textAlign:'left'}}><thead><tr>{['Venue','Status','Performances','Last checked','Reason'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{data.venues.map(v=><tr key={v.venue_id}><td>{v.venue_id}</td><td>{v.status}</td><td>{v.performance_count}</td><td>{v.checked_at}</td><td>{v.reason}</td></tr>)}</tbody></table>
 {data.errors.length>0&&<section><h2>Storage diagnostics</h2>{data.errors.map((e,i)=><p key={i}>{e.message}</p>)}</section>}</>}
 </main>;
}
