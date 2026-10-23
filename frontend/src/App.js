import { useEffect, useState } from 'react';
import './App.css';

function App() {
  const [backendStatus, setBackendStatus] = useState('Checking backend...');
  const [accounts, setAccounts] = useState([]);
  const [syncingId, setSyncingId] = useState(null);
  const [movingFileKey, setMovingFileKey] = useState(null);
  const [trashingFileKey, setTrashingFileKey] = useState(null);
  const [openFileMenuKey, setOpenFileMenuKey] = useState(null);
  const [activeMoveKey, setActiveMoveKey] = useState(null);
  const [pendingTrash, setPendingTrash] = useState(null);
  const [moveTargets, setMoveTargets] = useState({});
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [mediaView, setMediaView] = useState(false);
  const [mediaSort, setMediaSort] = useState('date');
  const [loadingMedia, setLoadingMedia] = useState(false);

  useEffect(() => {
    fetch('http://localhost:5000/api/health')
      .then((res) => res.json())
      .then((data) => setBackendStatus(data.message))
      .catch(() => setBackendStatus('Backend not reachable'));

    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      const res = await fetch('http://localhost:5000/api/accounts');
      const data = await res.json();
      setAccounts(data.accounts || []);
    } catch (err) {
      console.error('Failed to load accounts', err);
    }
  };

  const handleConnectGoogle = () => {
    window.location.href = 'http://localhost:5000/api/auth/google';
  };

  const handleSyncAccount = async (id) => {
    setSyncingId(id);
    try {
      const res = await fetch(`http://localhost:5000/api/files/sync/${id}`, { method: 'POST' });
      const data = await res.json();
      if (data.status === 'ok') {
        alert(`Synced ${data.filesSynced} files.`);
        loadAccounts();
      } else {
        alert(`Error: ${data.message}`);
      }
    } catch (err) {
      alert('Sync failed — check backend console.');
    } finally {
      setSyncingId(null);
    }
  };

  const handleRenameAccount = async (id, currentLabel) => {
    const newLabel = window.prompt('New label for this account:', currentLabel);
    if (!newLabel || !newLabel.trim()) return;

    try {
      await fetch(`http://localhost:5000/api/accounts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountLabel: newLabel.trim() }),
      });
      loadAccounts();
    } catch (err) {
      alert('Failed to rename account.');
    }
  };

  const handleDeleteAccount = async (id, email) => {
    const confirmed = window.confirm(`Delete account "${email}" and all its synced files?`);
    if (!confirmed) return;

    try {
      await fetch(`http://localhost:5000/api/accounts/${id}`, { method: 'DELETE' });
      loadAccounts();
    } catch (err) {
      alert('Failed to delete account.');
    }
  };

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    if (!searchTerm.trim()) return;

    try {
      const res = await fetch(`http://localhost:5000/api/search?q=${encodeURIComponent(searchTerm)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Search failed.');
      setMediaView(false);
      setSearchResults(data.results || []);
    } catch (err) {
      alert(`Search failed: ${err.message}`);
    }
  };

  const handleBrowseMedia = async () => {
    setLoadingMedia(true);
    try {
      const res = await fetch('http://localhost:5000/api/search?media=true');
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not load photos and videos.');
      setMediaView(true);
      setSearchResults(data.results || []);
    } catch (err) {
      alert(`Could not load photos and videos: ${err.message}`);
    } finally {
      setLoadingMedia(false);
    }
  };

  const refreshCurrentResults = async () => {
    if (mediaView) {
      await handleBrowseMedia();
    } else if (searchTerm.trim()) {
      await handleSearch();
    }
  };

  const handleMoveFile = async (fileName, source, destinationAccountId) => {
    const fileKey = `${source.accountId}:${source.fileId}`;
    const destination = accounts.find((account) => String(account.id) === destinationAccountId);
    if (!destination) return;

    const confirmed = window.confirm(
      `Copy "${fileName}" to ${destination.account_label}? The original will remain in ${source.accountLabel}.`
    );
    if (!confirmed) return;

    setMovingFileKey(fileKey);
    try {
      const res = await fetch('http://localhost:5000/api/files/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceAccountId: source.accountId,
          destinationAccountId,
          fileId: source.fileId,
        }),
      });
      const data = await res.json();

      if (data.status === 'partial') {
        alert(`${data.message} Sync the destination account to refresh its file index.`);
        setActiveMoveKey(null);
        loadAccounts();
        return;
      }
      if (!res.ok || data.status !== 'ok') {
        throw new Error(data.message || 'Move failed.');
      }

      alert(data.warning ? `${data.message} ${data.warning}` : data.message);
      setActiveMoveKey(null);
      await refreshCurrentResults();
      loadAccounts();
    } catch (err) {
      alert(`Move failed: ${err.message}`);
    } finally {
      setMovingFileKey(null);
    }
  };

  const handleViewInDrive = (fileId) => {
    const driveUrl = `https://drive.google.com/file/d/${fileId}/view`;
    window.open(driveUrl, '_blank', 'noopener,noreferrer');
    setOpenFileMenuKey(null);
  };

  const handleTrashFile = async () => {
    if (!pendingTrash) return;

    const { fileKey, source } = pendingTrash;
    setTrashingFileKey(fileKey);
    try {
      const res = await fetch('http://localhost:5000/api/files/trash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceAccountId: source.accountId,
          fileId: source.fileId,
        }),
      });
      const data = await res.json();

      if (data.status === 'partial') {
        alert(`${data.message} Refresh the search results to update the file index.`);
        setPendingTrash(null);
        await refreshCurrentResults();
        return;
      }
      if (!res.ok || data.status !== 'ok') {
        throw new Error(data.message || 'Could not move the file to trash.');
      }

      setPendingTrash(null);
      await refreshCurrentResults();
      loadAccounts();
    } catch (err) {
      alert(`Could not move file to trash: ${err.message}`);
    } finally {
      setTrashingFileKey(null);
    }
  };

  const displayResults = mediaView && searchResults
    ? searchResults
        .flatMap((result) =>
          result.availableIn.map((source) => ({
            fileName: result.fileName,
            availableIn: [source],
          }))
        )
        .sort((a, b) => {
          const sourceA = a.availableIn[0];
          const sourceB = b.availableIn[0];
          let comparison = 0;

          if (mediaSort === 'size') {
            const sizeA = sourceA.fileSize === null ? -1 : sourceA.fileSize;
            const sizeB = sourceB.fileSize === null ? -1 : sourceB.fileSize;
            comparison = sizeB - sizeA;
          } else if (mediaSort === 'type') {
            comparison = (sourceA.fileType || '').localeCompare(sourceB.fileType || '');
          } else {
            comparison =
              (sourceB.modifiedDate ? new Date(sourceB.modifiedDate).getTime() : 0) -
              (sourceA.modifiedDate ? new Date(sourceA.modifiedDate).getTime() : 0);
          }

          return comparison || a.fileName.localeCompare(b.fileName);
        })
    : searchResults;

  const formatFileSize = (size) => {
    if (size === null || size === undefined) return 'Size unavailable';
    const bytes = Number(size);
    if (!Number.isFinite(bytes)) return 'Size unavailable';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    return `${value.toFixed(1)} ${units[unitIndex]}`;
  };

  return (
    <div className="App">
      <header className="app-header">
        <h1>DeClutter</h1>
        <p className="status-line">Backend status: {backendStatus}</p>
        <button className="connect-btn" onClick={handleConnectGoogle}>
          Connect Google Drive
        </button>
      </header>

      <section className="section">
        <h2>Connected Accounts</h2>

        {accounts.length === 0 ? (
          <p className="empty-state">No accounts connected yet.</p>
        ) : (
          <div className="accounts-table-wrapper">
            <table className="accounts-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Label</th>
                  <th>Files Synced</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((acc) => (
                  <tr key={acc.id}>
                    <td>{acc.email}</td>
                    <td>{acc.account_label}</td>
                    <td>{acc.file_count}</td>
                    <td>
                      <div className="action-buttons">
                        <button onClick={() => handleSyncAccount(acc.id)} disabled={syncingId === acc.id}>
                          {syncingId === acc.id ? 'Syncing...' : 'Sync'}
                        </button>
                        <button className="secondary" onClick={() => handleRenameAccount(acc.id, acc.account_label)}>
                          Rename
                        </button>
                        <button className="danger" onClick={() => handleDeleteAccount(acc.id, acc.email)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <h2>Search Files</h2>
        <form className="search-form" onSubmit={handleSearch}>
          <input
            type="text"
            placeholder="Search for a file..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <button type="submit">Search</button>
        </form>

        <div className="media-browser-controls">
          <button
            type="button"
            onClick={handleBrowseMedia}
            disabled={loadingMedia}
          >
            {loadingMedia
              ? 'Loading media...'
              : mediaView
                ? 'Refresh photos & videos'
                : 'View photos & videos from all accounts'}
          </button>
          {mediaView && (
            <>
              <label className="media-sort">
                Sort by
                <select value={mediaSort} onChange={(event) => setMediaSort(event.target.value)}>
                  <option value="date">Date (newest first)</option>
                  <option value="size">Size (largest first)</option>
                  <option value="type">Type (A–Z)</option>
                </select>
              </label>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setMediaView(false);
                  setSearchResults(null);
                }}
              >
                Back to file search
              </button>
            </>
          )}
        </div>

        {searchResults && (
          <>
            <p className="results-count">
              {mediaView
                ? `${displayResults.length} photo(s) and video(s) across all connected accounts`
                : `${searchResults.length} result(s) found`}
            </p>
            <ul className={mediaView ? 'results-list media-results' : 'results-list'}>
              {displayResults.map((result, idx) => (
                <li
                  key={mediaView ? `${result.availableIn[0].accountId}:${result.availableIn[0].fileId}` : idx}
                  className={mediaView ? 'result-item media-result-item' : 'result-item'}
                >
                  {mediaView && (
                    <div className="media-preview">
                      <div className="media-preview-placeholder">
                        {result.availableIn[0].fileType.startsWith('video/')
                          ? 'Video preview unavailable'
                          : 'Photo preview unavailable'}
                      </div>
                      <img
                        src={`http://localhost:5000/api/files/${encodeURIComponent(
                          result.availableIn[0].accountId
                        )}/${encodeURIComponent(result.availableIn[0].fileId)}/thumbnail`}
                        alt={`Preview of ${result.fileName}`}
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.style.display = 'none';
                        }}
                      />
                      {result.availableIn[0].fileType.startsWith('video/') && (
                        <span className="video-preview-badge" aria-label="Video">▶</span>
                      )}
                    </div>
                  )}
                  <div className="result-filename">{result.fileName}</div>
                  {result.availableIn.map((source) => {
                    const fileKey = `${source.accountId}:${source.fileId}`;
                    const destinations = accounts.filter(
                      (account) => String(account.id) !== String(source.accountId)
                    );

                    return (
                      <div className="file-location" key={fileKey}>
                        <div className="file-location-heading">
                          <div>
                            <div className="result-locations">
                              Available in: {source.provider} ({source.accountLabel})
                            </div>
                            {mediaView && (
                              <div className="media-metadata">
                                <span>{source.fileType}</span>
                                <span>{formatFileSize(source.fileSize)}</span>
                                <span>
                                  {source.modifiedDate
                                    ? new Date(source.modifiedDate).toLocaleDateString()
                                    : 'Date unavailable'}
                                </span>
                              </div>
                            )}
                          </div>
                          <div className="file-actions">
                            <button
                              type="button"
                              className="file-menu-trigger"
                              aria-label={`More actions for ${result.fileName} in ${source.accountLabel}`}
                              aria-haspopup="menu"
                              aria-expanded={openFileMenuKey === fileKey}
                              onClick={() =>
                                setOpenFileMenuKey(openFileMenuKey === fileKey ? null : fileKey)
                              }
                            >
                              ⋮
                            </button>
                            {openFileMenuKey === fileKey && (
                              <div className="file-action-menu" role="menu">
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => handleViewInDrive(source.fileId)}
                                >
                                  ↗ View in Drive
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setOpenFileMenuKey(null);
                                    setActiveMoveKey(fileKey);
                                  }}
                                  disabled={destinations.length === 0}
                                >
                                  ↪ Move (keep original)
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setOpenFileMenuKey(null);
                                    setPendingTrash({ fileKey, fileName: result.fileName, source });
                                  }}
                                >
                                  Move to trash
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        {activeMoveKey === fileKey && (
                          <div className="move-form">
                            <label htmlFor={`destination-${fileKey}`}>Copy to</label>
                            <select
                              id={`destination-${fileKey}`}
                              value={moveTargets[fileKey] || ''}
                              onChange={(event) =>
                                setMoveTargets({ ...moveTargets, [fileKey]: event.target.value })
                              }
                              disabled={destinations.length === 0 || movingFileKey === fileKey}
                            >
                              <option value="">Choose destination account</option>
                              {destinations.map((account) => (
                                <option key={account.id} value={account.id}>
                                  {account.account_label} ({account.email})
                                </option>
                              ))}
                            </select>
                            <div className="move-form-actions">
                              <button
                                type="button"
                                onClick={() =>
                                  handleMoveFile(result.fileName, source, moveTargets[fileKey])
                                }
                                disabled={
                                  !moveTargets[fileKey] ||
                                  destinations.length === 0 ||
                                  movingFileKey === fileKey
                                }
                              >
                                {movingFileKey === fileKey ? 'Moving...' : 'Move'}
                              </button>
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => setActiveMoveKey(null)}
                                disabled={movingFileKey === fileKey}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      {pendingTrash && (
        <div className="confirmation-backdrop">
          <div
            className="confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="trash-confirmation-title"
            aria-describedby="trash-confirmation-message"
          >
            <h2 id="trash-confirmation-title">Move file to trash?</h2>
            <p id="trash-confirmation-message">
              Are you sure you want to move “{pendingTrash.fileName}” to trash? You can recover it before 30 days.
            </p>
            <div className="confirmation-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setPendingTrash(null)}
                disabled={trashingFileKey === pendingTrash.fileKey}
              >
                No
              </button>
              <button
                type="button"
                className="danger"
                onClick={handleTrashFile}
                disabled={trashingFileKey === pendingTrash.fileKey}
              >
                {trashingFileKey === pendingTrash.fileKey ? 'Moving...' : 'Yes, move to trash'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;