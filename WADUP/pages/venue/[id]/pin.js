import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/router';
import Head from 'next/head';
import {supabase} from '../../../lib/supabase';

const GMAPS_KEY=process.env.NEXT_PUBLIC_GMAPS_KEY || 'AIzaSyBoXf6UAa_SckH9gxfbiOK9OPpaySNH76w';
export default function VenuePinPicker(){
  const router=useRouter();
  const {id}=router.query;
  const mapNode=useRef(null),mapInstance=useRef(null),marker=useRef(null);
  const [venue,setVenue]=useState(null),[position,setPosition]=useState(null),[original,setOriginal]=useState(null);
  const [token,setToken]=useState(null),[authorized,setAuthorized]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[ready,setReady]=useState(false);
  useEffect(()=>{
    if(!id)return;
    let cancelled=false;
    Promise.all([supabase.from('venues').select('id,name,address,city,state,lat,lng').eq('id',id).single(),supabase.auth.getSession()]).then(async ([v,s])=>{
      if(cancelled)return;
      if(v.error||!v.data){setError('Venue not found');return;}
      const t=s.data.session?.access_token;
      if(!t){setError('Sign in with an authorized account to move a venue pin.');return;}
      const r=await fetch('/api/admin/venue-permissions?venueId='+encodeURIComponent(id),{headers:{Authorization:'Bearer '+t}});
      const permissions=r.ok?await r.json():{};
      if(cancelled)return;
      if(!permissions.canManage){setError('You do not have permission to move this venue pin.');return;}
      setAuthorized(true);setToken(t);setVenue(v.data);
      const lat=Number(v.data.lat),lng=Number(v.data.lng);
      const point=Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180&&!(lat===0&&lng===0)?{lat,lng}:{lat:35.0456,lng:-85.3097};
      setPosition(point);setOriginal(point);
    }).catch(()=>{if(!cancelled)setError('Unable to load venue permissions.');});
    return()=>{cancelled=true;};
  },[id]);
  useEffect(()=>{
    if(!authorized||!venue||!mapNode.current||!position||mapInstance.current)return;
    let cancelled=false;
    const init=()=>{
      if(cancelled||!mapNode.current||mapInstance.current)return;
      if(typeof window.google?.maps?.Map!=='function'){
        setError('Google Maps could not initialize. Check the Maps JavaScript API and allowed website domains.');
        return;
      }
      try{
        const map=new window.google.maps.Map(mapNode.current,{center:position,zoom:17,gestureHandling:'greedy',mapTypeControl:true,streetViewControl:false});
        mapInstance.current=map;
        marker.current=new window.google.maps.Marker({position,map,draggable:true,title:'Drag or click to move the venue pin'});
        const choose=point=>{if(point)setPosition({lat:point.lat(),lng:point.lng()});};
        map.addListener('click',e=>choose(e.latLng));
        marker.current.addListener('dragend',e=>choose(e.latLng));
        setError('');setReady(true);
      }catch(e){setError(e.message||'Could not initialize Google Maps.');}
    };
    if(typeof window.google?.maps?.Map==='function'){init();return()=>{cancelled=true;};}
    if(!GMAPS_KEY){setError('Google Maps is unavailable.');return;}
    const callbackName='__wadupPinMapInit';
    window[callbackName]=init;
    window.gm_authFailure=()=>{if(!cancelled)setError('Google Maps rejected this domain or API key. Check website restrictions.');};
    const script=document.createElement('script');
    script.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(GMAPS_KEY)+'&callback='+callbackName+'&v=weekly&loading=async';
    script.async=true;script.defer=true;
    script.onerror=()=>{if(!cancelled)setError('Could not download Google Maps.');};
    document.head.appendChild(script);
    return()=>{cancelled=true;if(window[callbackName]===init)delete window[callbackName];};
  },[authorized,venue]);
  useEffect(()=>{if(position&&marker.current)marker.current.setPosition(position);},[position]);
  const save=async()=>{
    if(!position||!token||!id)return;
    setBusy(true);setError('');
    try{
      const r=await fetch('/api/admin/venue-profile',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({venueId:id,updates:{lat:position.lat,lng:position.lng}})});
      const d=await r.json();
      if(!r.ok)throw Error(d.error||'Could not save pin');
      await router.replace('/venue/'+id+'?edit=1');
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };
  return <><Head><title>Place venue pin · WADUP</title></Head>
    <main style={{height:'100dvh',display:'flex',flexDirection:'column',background:'#061420',color:'white',fontFamily:'Arial,sans-serif'}}>
      <header style={{padding:'14px 18px',display:'flex',flexWrap:'wrap',alignItems:'center',justifyContent:'space-between',gap:12}}>
        <div><strong>📍 Place pin · {venue?.name||'WADUP'}</strong><div style={{fontSize:13,opacity:.8,marginTop:5}}>Click the map as many times as you like, or drag the pin. Nothing changes until you save.</div></div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={()=>router.push('/venue/'+id+'?edit=1')} style={{padding:'10px 16px',borderRadius:8}}>Cancel</button>
          <button disabled={!authorized||!ready||busy||!position} onClick={save} style={{padding:'10px 18px',borderRadius:8,background:'#fff500',color:'#111',fontWeight:800}}>{busy?'Saving…':'Save pin location'}</button>
        </div>
      </header>
      {error&&<div role="alert" style={{padding:12,background:'#58202b'}}>{error}</div>}
      {position&&<div style={{padding:'4px 18px',fontSize:12}}>Selected: {position.lat.toFixed(6)}, {position.lng.toFixed(6)} {original&&position.lat===original.lat&&position.lng===original.lng?'(current location)':''}</div>}
      <div ref={mapNode} style={{flex:1,minHeight:300}} aria-label="Click map to position venue pin"/>
    </main>
  </>;
}
