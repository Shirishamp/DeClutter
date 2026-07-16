import { useEffect, useState } from 'react';
import './App.css';

function App() {
  const [backendStatus, setBackendStatus] = useState('Checking backend...');
  const [syncStatus, setSyncStatus] = useState('');

  useEffect(() => {
    fetch('http://localhost:5000/api/health')
      .then((res) => res.json())
      .then((data) => setBackendStatus(data.message))
      .catch(() => setBackendStatus('Backend not reachable'));
  }, []);

  const handleConnectGoogle = () => {
    window.location.href = 'http://localhost:5000/api/auth/google';
  };

  const handleSync = async () => {
    setSyncStatus('Syncing...');
    try {
      // accountId=1 is hardcoded for now — real account selection comes in a later phase
      const res = await fetch('http://localhost:5000/api/files/sync/1', { method: 'POST' });
      const data = await res.json();
      if (data.status === 'ok') {
        setSyncStatus(`Synced ${data.filesSynced} files.`);
      } else {
        setSyncStatus(`Error: ${data.message}`);
      }
    } catch (err) {
      setSyncStatus('Sync failed — check backend console.');
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Cloud Metadata Index</h1>
        <p>Backend status: {backendStatus}</p>
        <button onClick={handleConnectGoogle}>Connect Google Drive</button>
        <button onClick={handleSync}>Sync Now</button>
        {syncStatus && <p>{syncStatus}</p>}
      </header>
    </div>
  );
}

export default App;