import { useEffect } from 'react'
import { useFilesStore, type FileEntry } from '../store/files.ts'
import { fetchDirectoryListing } from '../gateway/filesystem.ts'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatTime(ms: number): string {
  const d = new Date(ms)
  const month = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  const hours = d.getHours().toString().padStart(2, '0')
  const mins = d.getMinutes().toString().padStart(2, '0')
  return `${month}-${day} ${hours}:${mins}`
}

function FileIcon({ type }: { type: FileEntry['type'] }) {
  if (type === 'directory') {
    return <span className="text-claw-accent/80 text-sm w-5 text-center shrink-0">&#128193;</span>
  }
  if (type === 'symlink') {
    return <span className="text-claw-text-dim text-sm w-5 text-center shrink-0">&#128279;</span>
  }
  return <span className="text-claw-text-dim/60 text-sm w-5 text-center shrink-0">&#128196;</span>
}

function Breadcrumb({ path, onNavigate }: { path: string; onNavigate: (p: string) => void }) {
  const parts = path.split('/').filter(Boolean)

  return (
    <div className="flex items-center gap-0.5 text-xs overflow-x-auto whitespace-nowrap px-3 py-1.5 min-h-[28px]">
      <button
        onClick={() => onNavigate('/')}
        className="text-claw-accent/70 hover:text-claw-accent transition-colors shrink-0"
      >
        /
      </button>
      {parts.map((part, i) => {
        const fullPath = '/' + parts.slice(0, i + 1).join('/')
        const isLast = i === parts.length - 1
        return (
          <span key={fullPath} className="flex items-center gap-0.5">
            <span className="text-claw-text-dim/40">/</span>
            {isLast ? (
              <span className="text-claw-text font-medium">{part}</span>
            ) : (
              <button
                onClick={() => onNavigate(fullPath)}
                className="text-claw-accent/70 hover:text-claw-accent transition-colors"
              >
                {part}
              </button>
            )}
          </span>
        )
      })}
    </div>
  )
}

function FileRow({ entry, onNavigate }: { entry: FileEntry; onNavigate: (name: string) => void }) {
  const isDir = entry.type === 'directory'

  return (
    <button
      className={`
        w-full flex items-center gap-2 px-3 py-1.5 text-left
        hover:bg-claw-accent/5 transition-colors group
        ${isDir ? 'cursor-pointer' : 'cursor-default'}
      `}
      onDoubleClick={() => {
        if (isDir) onNavigate(entry.name)
      }}
      onClick={() => {
        if (isDir) onNavigate(entry.name)
      }}
    >
      <FileIcon type={entry.type} />
      <span className={`flex-1 text-xs truncate ${isDir ? 'text-claw-accent' : 'text-claw-text'}`}>
        {entry.name}
      </span>
      <span className="text-[10px] text-claw-text-dim/50 font-mono shrink-0 w-14 text-right">
        {isDir ? '--' : formatSize(entry.size)}
      </span>
      <span className="text-[10px] text-claw-text-dim/50 font-mono shrink-0 w-20 text-right hidden lg:block">
        {formatTime(entry.mtime)}
      </span>
    </button>
  )
}

export default function FileBrowser() {
  const { currentPath, entries, loading, error, navigateTo, goUp, refresh, setFetchFn, _fetchFn } =
    useFilesStore()

  // Initialize fetch function and load initial directory
  useEffect(() => {
    if (!_fetchFn) {
      setFetchFn(fetchDirectoryListing)
    }
  }, [_fetchFn, setFetchFn])

  // Load initial directory once fetch function is ready
  useEffect(() => {
    if (_fetchFn && entries.length === 0 && !loading) {
      navigateTo(currentPath)
    }
  }, [_fetchFn, entries.length, loading, navigateTo, currentPath])

  const handleNavigate = (name: string) => {
    navigateTo(currentPath + '/' + name)
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <span className="text-xs font-semibold text-claw-accent tracking-wide uppercase">
          Files
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={goUp}
            className="text-claw-text-dim hover:text-claw-text text-xs px-1.5 py-0.5 rounded hover:bg-claw-accent/10 transition-colors"
            title="Go up"
          >
            ..
          </button>
          <button
            onClick={refresh}
            className="text-claw-text-dim hover:text-claw-text text-xs px-1.5 py-0.5 rounded hover:bg-claw-accent/10 transition-colors"
            title="Refresh"
          >
            &#8635;
          </button>
        </div>
      </div>

      {/* Breadcrumb */}
      <Breadcrumb path={currentPath} onNavigate={navigateTo} />

      {/* Divider */}
      <div className="h-px bg-claw-border/20 mx-3" />

      {/* File list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && (
          <div className="p-3 text-xs text-claw-text-dim animate-pulse">Loading...</div>
        )}
        {error && (
          <div className="p-3 text-xs text-claw-error">{error}</div>
        )}
        {!loading && !error && entries.length === 0 && (
          <div className="p-3 text-xs text-claw-text-dim/50">Empty directory</div>
        )}
        {!loading && entries.map((entry) => (
          <FileRow key={entry.name} entry={entry} onNavigate={handleNavigate} />
        ))}
      </div>
    </div>
  )
}
