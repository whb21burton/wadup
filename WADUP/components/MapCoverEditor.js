import {useState,useRef} from 'react';

export default function MapCoverEditor({venue,session,onClose,onSaved}) {
  const [image,setImage]=useState('');
  const [x,setX]=useState(venue.cover_mobile_position_x??50);
  const [y,setY]=useState(venue.cover_mobile_position_y??50);
  const [zoom,setZoom]=useState(Number(venue.cover_mobile_zoom)||1);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const drag=useRef(null);
  const photo=image||venue.cover_photo_mobile_url||venue.cover_photo_url;
  const readPhoto=e=>{
    const file=e.target.files?.[0];
    if(!file)return;
    if(!file.type.startsWith('image/')){setError('Choose an image.');return;}
    if(file.size>5*1024*1024){setError('Choose a photo under 5 MB.');return;}
    const reader=new FileReader();
    reader.onload=()=>{setImage(String(reader.result));setError('');};
    reader.readAsDataURL(file);
  };
  const save=async()=>{
    setBusy(true);setError('');
    try{
      let endpoint='/api/admin/venue-profile';
      let body={venueId:venue.id,updates:{cover_mobile_position_x:x,cover_mobile_position_y:y,cover_mobile_zoom:zoom}};
      if(image){
        const img=new Image();img.src=image;await img.decode();
        const scale=Math.min(1,2200/img.naturalWidth,2200/img.naturalHeight);
        const canvas=document.createElement('canvas');
        canvas.width=Math.round(img.naturalWidth*scale);canvas.height=Math.round(img.naturalHeight*scale);
        canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
        endpoint='/api/admin/venue-cover-upload';
        body={venueId:venue.id,image:canvas.toDataURL('image/jpeg',.86),positionX:x,positionY:y,zoom,device:'mobile'};
      }
      const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify(body)});
      const result=await res.json();if(!res.ok)throw Error(result.error||'Could not save photo');
      onSaved(result.venue);
    }catch(e){setError(e.message)}finally{setBusy(false)}
  };
  return <div className="wu-map-photo-backdrop" onClick={onClose}>
    <div className="wu-map-photo-editor" onClick={e=>e.stopPropagation()}>
      <div className="wu-map-photo-top"><strong>📷 Map & Phone Photo</strong><button type="button" onClick={onClose} aria-label="Close">✕</button></div>
      <p>Changes here appear on the map popup and the phone profile. Drag to position the photo.</p>
      <div className="wu-map-photo-preview" onPointerDown={e=>{e.preventDefault();drag.current={x:e.clientX,y:e.clientY,px:x,py:y};e.currentTarget.setPointerCapture(e.pointerId)}} onPointerMove={e=>{if(!drag.current)return;const r=e.currentTarget.getBoundingClientRect();setX(Math.max(0,Math.min(100,Math.round(drag.current.px-(e.clientX-drag.current.x)/r.width*100))));setY(Math.max(0,Math.min(100,Math.round(drag.current.py-(e.clientY-drag.current.y)/r.height*100))))}} onPointerUp={()=>drag.current=null} onPointerCancel={()=>drag.current=null}>
        {photo&&<img src={photo} alt="" draggable={false} style={{transform:`translate(${(50-x)*2}px,${(50-y)*2}px) scale(${zoom})`}}/>}
        <div className="wu-map-photo-preview-text"><b>{venue.name}</b><span>📍 {venue.address}</span></div>
      </div>
      <label className="wu-map-photo-upload">📷 Choose photo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={readPhoto} hidden/></label>
      <label>Zoom <span>{Math.round(zoom*100)}%</span><input type="range" min=".5" max="3" step=".05" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label>
      <label>Left / right<input type="range" min="0" max="100" value={x} onChange={e=>setX(Number(e.target.value))}/></label>
      <label>Up / down<input type="range" min="0" max="100" value={y} onChange={e=>setY(Number(e.target.value))}/></label>
      {error&&<p role="alert" style={{color:'#ff8888'}}>{error}</p>}
      <div className="wu-map-photo-actions"><button type="button" onClick={onClose}>Cancel</button><button type="button" disabled={busy||!photo} onClick={save}>{busy?'Saving…':'Save photo'}</button></div>
    </div>
  </div>;
}
