// Simple markdown-to-HTML converter for chat messages
// This is a lightweight implementation; we'll add react-markdown in M5

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function stripOpenClawDebugInfo(text: string): string {
  let cleaned = text

  // Strip OpenClaw protocol tags
  cleaned = cleaned.replace(/<\/?(?:final|thinking|tool_call|artifact|result|search|context|output|input)[^>]*>/gi, '')

  // Strip OpenClaw emoji debug lines
  const debugLinePattern = /^[\s]*(?:🦞|⏰|🧠|🏁|🧶|📊|📋|⚙️|⏳|🔧|📡|🔒|🌐|💾|🔑|📝|🎯|🤖|✅|❌|⚠️|🔄)[\s]?(?:OpenClaw|Time:|Model:|Tokens:|Context:|Usage:|Session:|Runtime:|Queue:|Think:|Compaction|Memory|Status|Tool|Result|Error|Success)[^\n]*$/gm
  cleaned = cleaned.replace(debugLinePattern, '')

  // Strip OpenClaw system prompt doc markers
  cleaned = cleaned.replace(/^#\s*(?:BOOTSTRAP|USER|SOUL|CONTEXT|SYSTEM|MEMORY|AGENTS)\.md[^\n]*\n?/gm, '')

  // Strip tool call markers like [tool: xxx] or [executing: xxx]
  cleaned = cleaned.replace(/^\[(?:tool|executing|running|calling):\s*[^\]]+\]\s*$/gm, '')

  // Strip pacman/system command raw output lines
  cleaned = cleaned.replace(/^(?:local\/\w+\s+[\d.-]+|checking dependencies|removing\s+\w+|Packages\s*\(\d+\))[^\n]*$/gm, '')

  // Strip raw JSON status blocks
  cleaned = cleaned.replace(/^\s*\{\s*"(?:status|tool|error|result)"\s*:[^}]*\}\s*$/gm, '')

  // Remove consecutive blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n')

  return cleaned.trim()
}

export function renderMarkdown(text: string): string {
  const cleaned = stripOpenClawDebugInfo(text)
  let html = escapeHtml(cleaned)

  // Code blocks ```
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    return `<pre class="code-block"><code class="language-${lang}">${code.trim()}</code></pre>`
  })

  // Inline code `
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')

  // Bold **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

  // Italic *text*
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="text-claw-accent hover:underline">$1</a>')

  // Line breaks
  html = html.replace(/\n/g, '<br/>')

  return html
}
