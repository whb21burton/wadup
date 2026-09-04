import { useState } from 'react';
import { useRouter } from 'next/router';

export default function SyncPage() {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const runSync = async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch('/api/places/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': password
        }
      });
      const data = await res.json();
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#050d1a',
      color: '#fff',
      padding: '40px',
      fontFamily: 'Inter, sans-serif'
    }}>
      <h1 style={{ color: '#FFFC00', marginBottom: '32px' }}>
        🔄 Venue Sync
      </h1>

      <div style={{ maxWidth: '500px' }}>
        <label style={{ display: 'block', marginBottom: '8px', color: '#aaa' }}>
          Admin Password
        </label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="Enter admin password"
          style={{
            width: '100%',
            padding: '12px',
            background: '#0a1628',
            border: '1px solid #00e5ff',
            borderRadius: '8px',
            color: '#fff',
            fontSize: '1rem',
            marginBottom: '16px'
          }}
        />

        <button
          onClick={runSync}
          disabled={loading || !password}
          style={{
            width: '100%',
            padding: '16px',
            background: loading ? '#666' : '#FFFC00',
            color: '#000',
            border: 'none',
            borderRadius: '8px',
            fontSize: '1rem',
            fontWeight: '800',
            cursor: loading ? 'not-allowed' : 'pointer',
            marginBottom: '24px'
          }}
        >
          {loading ? '⏳ Syncing... (this takes ~20 seconds)' : '🔄 Sync Chattanooga Venues'}
        </button>

        {error && (
          <div style={{ background: '#ff000022', border: '1px solid #ff4444', borderRadius: '8px', padding: '16px', color: '#ff4444' }}>
            ❌ Error: {error}
          </div>
        )}

        {result && (
          <div style={{ background: '#00ff0011', border: '1px solid #00e676', borderRadius: '8px', padding: '16px' }}>
            <div style={{ color: '#00e676', fontWeight: '800', marginBottom: '8px' }}>✅ Sync Complete!</div>
            <div>Added to queue: {result.added_to_queue || result.added || 0}</div>
            <div>Already live: {result.already_live || result.updated || 0}</div>
            <div>Skipped: {result.skipped || 0}</div>
            <div>Total fetched: {result.totalFetched || 0}</div>
            {result.byCategory && (
              <div style={{ marginTop: '12px' }}>
                <div style={{ fontWeight: '700', marginBottom: '4px' }}>By Category:</div>
                {Object.entries(result.byCategory).map(([cat, count]) => (
                  <div key={cat}>• {cat}: {count}</div>
                ))}
              </div>
            )}
            {result.errors && result.errors.length > 0 && (
              <div style={{ marginTop: '12px', color: '#ff8844' }}>
                <div>⚠️ Errors ({result.errors.length}):</div>
                {result.errors.slice(0, 5).map((e, i) => (
                  <div key={i} style={{ fontSize: '0.8rem' }}>• {e}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
