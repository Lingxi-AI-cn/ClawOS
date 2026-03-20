import SystemInfo from './SystemInfo.tsx'
import FileBrowser from './FileBrowser.tsx'

export default function LeftPanel() {
  return (
    <div className="w-[320px] shrink-0 flex flex-col bg-claw-surface/70 backdrop-blur-lg border-r border-claw-border/10 overflow-hidden">
      {/* System Info - compact, fixed height */}
      <div className="shrink-0 border-b border-claw-border/10">
        <SystemInfo />
      </div>

      {/* File Browser - fills remaining space */}
      <FileBrowser />
    </div>
  )
}
