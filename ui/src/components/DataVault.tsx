import { useEffect } from 'react'
import { Folder, FileImage, FileVideo, FileMusic, FileText, MoreVertical } from 'lucide-react'
import { motion } from 'motion/react'
import { useFilesStore, type FileEntry } from '../store/files.ts'
import { fetchDirectoryListing } from '../gateway/filesystem.ts'

function getIcon(entry: FileEntry) {
  if (entry.type === 'directory') return <Folder className="text-yellow-400" size={24} />
  const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'].includes(ext))
    return <FileImage className="text-purple-400" size={24} />
  if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext))
    return <FileVideo className="text-red-400" size={24} />
  if (['mp3', 'wav', 'flac', 'ogg', 'aac'].includes(ext))
    return <FileMusic className="text-pink-400" size={24} />
  if (['pdf'].includes(ext))
    return <FileText className="text-blue-400" size={24} />
  return <FileText className="text-gray-400" size={24} />
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export default function DataVault() {
  const { currentPath, entries, loading, error, navigateTo, setFetchFn, _fetchFn } =
    useFilesStore()

  useEffect(() => {
    if (!_fetchFn) setFetchFn(fetchDirectoryListing)
  }, [_fetchFn, setFetchFn])

  useEffect(() => {
    if (_fetchFn && entries.length === 0 && !loading) {
      navigateTo(currentPath)
    }
  }, [_fetchFn, entries.length, loading, navigateTo, currentPath])

  const handleNavigate = (name: string) => {
    navigateTo(currentPath + '/' + name)
  }

  return (
    <div className="w-full p-2">
      <div className="flex justify-between items-center mb-4 px-2">
        <h3 className="text-white/80 font-medium tracking-wide text-sm uppercase">Recent Assets</h3>
        <button className="text-white/40 hover:text-white transition-colors">
          <MoreVertical size={16} />
        </button>
      </div>

      {loading && (
        <div className="text-xs text-gray-500 p-4 text-center animate-pulse">Loading...</div>
      )}
      {error && (
        <div className="text-xs text-red-400 p-4 text-center">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {!loading && entries.map((item, index) => (
          <motion.div
            key={item.name}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.05 }}
            onClick={() => {
              if (item.type === 'directory') handleNavigate(item.name)
            }}
            className={`group flex flex-col items-center justify-center p-4 bg-white/5 hover:bg-white/10 border border-white/5 hover:border-cyan-500/30 rounded-xl transition-all ${
              item.type === 'directory' ? 'cursor-pointer' : 'cursor-default'
            }`}
          >
            <div className="mb-3 p-3 rounded-full bg-black/20 group-hover:scale-110 transition-transform">
              {getIcon(item)}
            </div>
            <span className="text-xs text-gray-300 font-medium truncate w-full text-center">{item.name}</span>
            <span className="text-[10px] text-gray-500 mt-1">
              {item.type === 'directory'
                ? `${entries.length} items`
                : formatSize(item.size)}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
