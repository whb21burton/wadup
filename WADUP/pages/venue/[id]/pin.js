import { useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

// Legacy pin links now open the existing WADUP discovery map.
// Avoid creating a second Google Maps instance and an extra map load.
export default function VenuePinRedirect() {
  const router = useRouter();
  const { id } = router.query;
  useEffect(() => {
    if (typeof id === 'string' && id) router.replace('/?placePin=' + encodeURIComponent(id));
  }, [id, router]);
  return <><Head><title>Opening WADUP map…</title></Head><main style={{minHeight:'100vh',background:'#061420',color:'white',padding:24}}>Opening the WADUP map for pin placement…</main></>;
}
