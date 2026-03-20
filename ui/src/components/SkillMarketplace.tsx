import { useState, useEffect } from 'react'
import { Download, X, Trash2 } from 'lucide-react'
import { ClawOSBridge } from '../gateway/bridge.ts'

const SKILL_SERVICE_URL = 'http://127.0.0.1:3000'

interface Skill {
  slug: string
  name: string
  description: string
  descriptionZh: string
  translated: boolean
  downloads: number
  compatibility: {
    score: number | null
    compatible: boolean | null
    issues: string[]
    level: string
  }
}

export default function SkillMarketplace({ onClose }: { onClose: () => void }) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [installedSkills, setInstalledSkills] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [installing, setInstalling] = useState<string | null>(null)
  const [uninstalling, setUninstalling] = useState<string | null>(null)
  const [filterEnabled, setFilterEnabled] = useState(false)
  const [warningSkill, setWarningSkill] = useState<Skill | null>(null)
  const [checkingCompat, setCheckingCompat] = useState<string | null>(null)
  const [tab, setTab] = useState<'all' | 'installed'>('all')
  const [skillsDir, setSkillsDir] = useState<string>('')

  useEffect(() => {
    fetch(`${SKILL_SERVICE_URL}/api/skills`)
      .then(r => r.json())
      .then(data => setSkills(Array.isArray(data) ? data : []))
      .catch(err => {
        console.error('Failed to load skills:', err)
        setSkills([])
      })

    loadSkillsDirectory()
    loadInstalledSkills()
  }, [])

  const loadSkillsDirectory = async () => {
    try {
      const result = await ClawOSBridge?.getSkillsDirectory()
      setSkillsDir(result?.path || '')
    } catch (err) {
      console.error('[SkillMarketplace] Failed to get skills directory:', err)
    }
  }

  const loadInstalledSkills = async () => {
    console.log('[SkillMarketplace] loadInstalledSkills called')
    try {
      const result = await ClawOSBridge?.listInstalledSkills()
      console.log('[SkillMarketplace] listInstalledSkills result:', result)
      setInstalledSkills(result?.skills || [])
    } catch (err) {
      console.error('[SkillMarketplace] Failed to load installed skills:', err)
    }
  }

  const handleInstall = async (skill: Skill) => {
    console.log('[SkillMarketplace] handleInstall called for:', skill.slug)
    setCheckingCompat(skill.slug)
    try {
      console.log('[SkillMarketplace] Fetching compatibility...')
      const res = await fetch(`${SKILL_SERVICE_URL}/api/skills/${skill.slug}/compatibility`)
      const { compatibility } = await res.json()
      console.log('[SkillMarketplace] Compatibility result:', compatibility)

      setSkills(prev => prev.map(s =>
        s.slug === skill.slug ? { ...s, compatibility } : s
      ))

      if (compatibility?.score !== null && compatibility?.score < 60) {
        console.log('[SkillMarketplace] Low compatibility, showing warning')
        setWarningSkill({ ...skill, compatibility })
      } else {
        console.log('[SkillMarketplace] Starting installation')
        installSkill(skill.slug)
      }
    } catch (err) {
      console.error('[SkillMarketplace] 兼容性检测失败:', err)
      installSkill(skill.slug)
    } finally {
      setCheckingCompat(null)
    }
  }

  const installSkill = async (slug: string) => {
    console.log('[SkillMarketplace] installSkill called for:', slug)
    setInstalling(slug)
    try {
      console.log('[SkillMarketplace] Downloading skill...')
      const res = await fetch(`${SKILL_SERVICE_URL}/api/skills/${slug}/download`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || `Server error: ${res.status}`)
      }
      const { files } = data
      console.log('[SkillMarketplace] Downloaded files count:', Object.keys(files || {}).length)

      if (!files || Object.keys(files).length === 0) {
        throw new Error('No files downloaded')
      }

      for (const [path, content] of Object.entries(files)) {
        console.log('[SkillMarketplace] Writing file:', path)
        await ClawOSBridge?.writeFile({
          path: `${skillsDir}/${slug}/${path}`,
          content: content as string
        })
      }

      console.log('[SkillMarketplace] Restarting gateway...')
      await ClawOSBridge?.restartGateway()
      console.log('[SkillMarketplace] Refreshing installed skills list...')
      await loadInstalledSkills()
      alert('Skill 安装成功！')
    } catch (err) {
      console.error('[SkillMarketplace] 安装失败:', err)
      alert('安装失败: ' + err)
    } finally {
      setInstalling(null)
    }
  }

  const handleUninstall = async (slug: string) => {
    if (!confirm(`确定要卸载 ${slug} 吗？`)) return

    setUninstalling(slug)
    try {
      await ClawOSBridge?.deleteSkill({ slug })
      await ClawOSBridge?.restartGateway()
      await loadInstalledSkills() // 刷新已安装列表
      alert('Skill 卸载成功！')
    } catch (err) {
      alert('卸载失败: ' + err)
    } finally {
      setUninstalling(null)
    }
  }

  const filtered = skills
    .filter(s => tab === 'installed' ? installedSkills.includes(s.slug) : true)
    .filter(s => filterEnabled ? (s.compatibility?.score !== null && s.compatibility?.score >= 60) : true)
    .filter(s =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.descriptionZh.toLowerCase().includes(search.toLowerCase())
    )

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: '#12141f', display: 'flex', flexDirection: 'column'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)'
      }}>
        <h2 style={{ margin: 0, fontSize: 18, color: '#fff' }}>Skill 市场</h2>
        <button
          onClick={onClose}
          style={{
            width: 40, height: 40, borderRadius: '50%', border: 'none',
            background: 'rgba(255,255,255,0.1)', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer'
          }}
        >
          <X size={20} />
        </button>
      </div>

      {/* Tabs */}
      <div style={{ padding: '0 16px 12px', display: 'flex', gap: 8 }}>
        <button
          onClick={() => setTab('all')}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 'none',
            background: tab === 'all' ? '#3b82f6' : 'rgba(255,255,255,0.1)',
            color: '#fff', cursor: 'pointer', fontSize: 14
          }}
        >
          全部
        </button>
        <button
          onClick={() => setTab('installed')}
          style={{
            padding: '8px 16px', borderRadius: 8, border: 'none',
            background: tab === 'installed' ? '#3b82f6' : 'rgba(255,255,255,0.1)',
            color: '#fff', cursor: 'pointer', fontSize: 14
          }}
        >
          已安装 ({installedSkills.length})
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <input
          type="text"
          placeholder="搜索 Skills..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, padding: 12, borderRadius: 8,
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
            color: '#fff', fontSize: 15
          }}
        />
        <label style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: '#fff',
          fontSize: 14,
          whiteSpace: 'nowrap',
          cursor: 'pointer'
        }}>
          <input
            type="checkbox"
            checked={filterEnabled}
            onChange={e => setFilterEnabled(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          仅兼容
        </label>
      </div>

      {/* Skills List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px' }}>
        {filtered.map(skill => (
          <div key={skill.slug} style={{
            background: 'rgba(255,255,255,0.03)', borderRadius: 12,
            padding: 16, marginBottom: 12, border: '1px solid rgba(255,255,255,0.06)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0, fontSize: 16, color: '#fff' }}>{skill.name}</h3>
                <p style={{ margin: '4px 0', fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
                  {skill.descriptionZh}
                  {!skill.translated && (
                    <span style={{ marginLeft: 4, fontSize: 11, color: '#6b7280' }}>
                      (原文)
                    </span>
                  )}
                </p>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 6,
                    background: skill.compatibility?.score === null ? '#6b728020' :
                      skill.compatibility?.score >= 80 ? '#22c55e20' :
                      skill.compatibility?.score >= 60 ? '#eab30820' : '#ef444420',
                    color: skill.compatibility?.score === null ? '#6b7280' :
                      skill.compatibility?.score >= 80 ? '#22c55e' :
                      skill.compatibility?.score >= 60 ? '#eab308' : '#ef4444'
                  }}>
                    兼容性: {skill.compatibility?.score === null ? '未评估' : `${skill.compatibility?.score}%`}
                  </span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                    {skill.downloads} 下载
                  </span>
                </div>
              </div>
              {installedSkills.includes(skill.slug) ? (
                <button
                  onClick={() => handleUninstall(skill.slug)}
                  disabled={uninstalling === skill.slug}
                  style={{
                    padding: '8px 16px', borderRadius: 8, border: 'none',
                    background: uninstalling === skill.slug ? '#6b7280' : '#ef4444',
                    color: '#fff', cursor: uninstalling === skill.slug ? 'default' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6
                  }}
                >
                  {uninstalling === skill.slug ? '卸载中...' : <><Trash2 size={16} /> 卸载</>}
                </button>
              ) : (
                <button
                  onClick={() => handleInstall(skill)}
                  disabled={installing === skill.slug || checkingCompat === skill.slug}
                  style={{
                    padding: '8px 16px', borderRadius: 8, border: 'none',
                    background: (installing === skill.slug || checkingCompat === skill.slug) ? '#6b7280' : '#3b82f6',
                    color: '#fff', cursor: (installing === skill.slug || checkingCompat === skill.slug) ? 'default' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6
                  }}
                >
                  {checkingCompat === skill.slug ? '检测中...' :
                   installing === skill.slug ? '安装中...' :
                   <><Download size={16} /> 安装</>}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Warning Modal */}
      {warningSkill && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 10000,
          background: 'rgba(0,0,0,0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16
        }}>
          <div style={{
            background: '#1f2937',
            borderRadius: 12,
            padding: 24,
            maxWidth: 400,
            width: '100%'
          }}>
            <h3 style={{ margin: '0 0 12px', color: '#fff', fontSize: 18 }}>
              兼容性警告
            </h3>
            <p style={{
              margin: '0 0 16px',
              color: 'rgba(255,255,255,0.7)',
              fontSize: 14,
              lineHeight: 1.5
            }}>
              此 Skill 可能不完全兼容 Android 环境（兼容性评分: {warningSkill.compatibility?.score}%）
            </p>
            {warningSkill.compatibility?.issues?.length > 0 && (
              <ul style={{
                margin: '0 0 16px',
                paddingLeft: 20,
                color: '#ef4444',
                fontSize: 13
              }}>
                {warningSkill.compatibility.issues.map((issue, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>{issue}</li>
                ))}
              </ul>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setWarningSkill(null)}
                style={{
                  flex: 1,
                  padding: 10,
                  borderRadius: 8,
                  border: 'none',
                  background: '#374151',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 14
                }}
              >
                取消
              </button>
              <button
                onClick={() => {
                  const slug = warningSkill.slug
                  setWarningSkill(null)
                  installSkill(slug)
                }}
                style={{
                  flex: 1,
                  padding: 10,
                  borderRadius: 8,
                  border: 'none',
                  background: '#3b82f6',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 14
                }}
              >
                继续安装
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
