import { useCallback, useState, type CSSProperties } from 'react'
import {
  ArrowLeft, Check, Loader2, AlertTriangle,
  ChevronRight, ExternalLink, Copy, CheckCircle2,
  MessageSquare, Send, Hash, Bot, Sparkles,
} from 'lucide-react'
import { IM_PLATFORMS, type IMChannelInfo } from '../store/imChannels.ts'
import { ClawOSBridge, isAndroid } from '../gateway/bridge.ts'

function openExternal(url: string) {
  if (isAndroid && ClawOSBridge) {
    ClawOSBridge.openUrl({ url }).catch((err) => {
      console.warn('[IMWizard] openUrl failed:', err)
      try { window.open(url, '_blank') } catch { /* ignore */ }
    })
  } else {
    window.open(url, '_blank')
  }
}

type WizardStep =
  | 'pick'
  | 'guide'
  | 'credentials'
  | 'verify'
  | 'options'
  | 'save'
  | 'done'
  | 'plugin-install'
  | 'ai-creds'

interface IMSetupWizardProps {
  onComplete: () => void
  onCancel: () => void
  onAISetup?: (platformId: string, credsFile?: string) => void
}

const CONFIG_PATH = '/data/local/tmp/clawos/openclaw.json'

const platformIcons: Record<string, { emoji: string; color: string }> = {
  telegram: { emoji: '✈️', color: '#26a5e4' },
  discord: { emoji: '🎮', color: '#5865f2' },
  slack: { emoji: '💬', color: '#4a154b' },
  feishu: { emoji: '🐦', color: '#00d6b9' },
  dingtalk: { emoji: '🔷', color: '#0089ff' },
}

export default function IMSetupWizard({ onComplete, onCancel, onAISetup }: IMSetupWizardProps) {
  const [step, setStep] = useState<WizardStep>('pick')
  const [platform, setPlatform] = useState<IMChannelInfo | null>(null)
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [verifyResult, setVerifyResult] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [pluginInstalling, setPluginInstalling] = useState(false)
  const [pluginInstalled, setPluginInstalled] = useState(false)
  const [discordAppId, setDiscordAppId] = useState('')
  const [copied, setCopied] = useState(false)
  const [urlCopied, setUrlCopied] = useState(false)
  const [aiCredsEmail, setAiCredsEmail] = useState('')
  const [aiCredsPassword, setAiCredsPassword] = useState('')
  const [aiCredsSaving, setAiCredsSaving] = useState(false)

  const handlePickPlatform = useCallback((p: IMChannelInfo) => {
    if (p.comingSoon) return
    setPlatform(p)
    setCredentials({})
    setError('')
    setVerifyResult('')
    setSuccess(false)
    setDiscordAppId('')
    setPluginInstalled(false)

    if (!p.builtin && (p.id === 'feishu' || p.id === 'dingtalk')) {
      setStep('plugin-install')
    } else {
      setStep('guide')
    }
  }, [])

  const handleBack = useCallback(() => {
    setError('')
    switch (step) {
      case 'pick': onCancel(); break
      case 'guide': setStep('pick'); break
      case 'plugin-install': setStep('pick'); break
      case 'credentials':
        setStep(platform?.id === 'feishu' || platform?.id === 'dingtalk' ? 'plugin-install' : 'guide')
        break
      case 'verify': setStep('credentials'); break
      case 'options': setStep('verify'); break
      case 'save': setStep('options'); break
      case 'done': break
    }
  }, [step, onCancel, platform])

  const handleCredentialChange = useCallback((key: string, value: string) => {
    setCredentials(prev => ({ ...prev, [key]: value }))
    setError('')
  }, [])

  const handleInstallPlugin = useCallback(async () => {
    if (!platform) return
    const pluginId = platform.id
    setPluginInstalling(true)
    setError('')
    try {
      if (isAndroid && ClawOSBridge) {
        await ClawOSBridge.installPlugin({ pluginId })
        await ClawOSBridge.patchJsonFile({
          path: CONFIG_PATH,
          jsonPath: `plugins.entries.${pluginId}`,
          value: JSON.stringify({ enabled: true }),
        })
      } else {
        console.log(`[IMWizard] installPlugin: ${pluginId} (mock)`)
        await new Promise(r => setTimeout(r, 1000))
      }
      setPluginInstalled(true)
      setTimeout(() => setStep('guide'), 600)
    } catch (err: any) {
      setError(err?.message || '插件安装失败')
    } finally {
      setPluginInstalling(false)
    }
  }, [platform])

  const allCredentialsFilled = platform
    ? platform.credentialFields.every(f => (credentials[f.key] ?? '').trim().length > 0)
    : false

  const handleVerify = useCallback(async () => {
    if (!platform || !allCredentialsFilled) return
    setVerifying(true)
    setError('')
    setVerifyResult('')

    try {
      switch (platform.id) {
        case 'telegram': {
          const token = credentials.botToken.trim()
          if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
            throw new Error('Token 格式不正确，应为如 123456:ABC-DEF...')
          }
          const res = await fetch(`https://api.telegram.org/bot${token}/getMe`)
          const data = await res.json()
          if (!data.ok) throw new Error(data.description || 'Token 无效')
          setVerifyResult(`Bot: @${data.result.username} (${data.result.first_name})`)
          break
        }
        case 'discord': {
          const token = credentials.token.trim()
          const res = await fetch('https://discord.com/api/v10/users/@me', {
            headers: { Authorization: `Bot ${token}` },
          })
          if (!res.ok) throw new Error(`Discord API 返回 ${res.status}: Token 无效`)
          const data = await res.json()
          setDiscordAppId(data.id)
          setVerifyResult(`Bot: ${data.username}#${data.discriminator}`)
          break
        }
        case 'slack': {
          const token = credentials.botToken.trim()
          if (!token.startsWith('xoxb-')) {
            throw new Error('Bot Token 应以 xoxb- 开头')
          }
          const appToken = credentials.appToken?.trim()
          if (appToken && !appToken.startsWith('xapp-')) {
            throw new Error('App Token 应以 xapp- 开头')
          }
          const res = await fetch('https://slack.com/api/auth.test', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          })
          const data = await res.json()
          if (!data.ok) throw new Error(data.error || 'Token 无效')
          setVerifyResult(`Bot: ${data.bot_id} @ ${data.team}`)
          break
        }
        case 'feishu': {
          const appId = credentials.appId.trim()
          const appSecret = credentials.appSecret.trim()
          const res = await fetch(
            'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal/',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
            }
          )
          const data = await res.json()
          if (data.code !== 0) throw new Error(data.msg || '凭据无效')
          setVerifyResult('飞书应用验证成功')
          break
        }
        case 'dingtalk': {
          const clientId = credentials.clientId.trim()
          const clientSecret = credentials.clientSecret.trim()
          const res = await fetch(
            'https://api.dingtalk.com/v1.0/oauth2/accessToken',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ appKey: clientId, appSecret: clientSecret }),
            }
          )
          const data = await res.json()
          if (!data.accessToken) throw new Error(data.message || '凭据无效')
          setVerifyResult('钉钉应用验证成功')
          break
        }
      }
      setStep('options')
    } catch (err: any) {
      setError(err?.message || '验证失败')
    } finally {
      setVerifying(false)
    }
  }, [platform, credentials, allCredentialsFilled])

  const handleSave = useCallback(async () => {
    if (!platform) return
    setSaving(true)
    setError('')
    try {
      const channelConfig = buildChannelConfig(platform, credentials)

      if (isAndroid && ClawOSBridge) {
        await ClawOSBridge.patchJsonFile({
          path: CONFIG_PATH,
          jsonPath: `channels.${platform.id}`,
          value: JSON.stringify(channelConfig),
        })
        await ClawOSBridge.restartGateway()
      } else {
        console.log('[IMWizard] Channel config:', platform.id, channelConfig)
        await new Promise(r => setTimeout(r, 800))
      }

      setSuccess(true)
      setStep('done')
    } catch (err: any) {
      setError(err?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }, [platform, credentials])

  const handleDone = useCallback(() => {
    onComplete()
  }, [onComplete])

  const handleCopyInvite = useCallback(async () => {
    if (!discordAppId) return
    const url = `https://discord.com/api/oauth2/authorize?client_id=${discordAppId}&permissions=274877910016&scope=bot`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      openExternal(url)
    }
  }, [discordAppId])

  const stepTitle = (): string => {
    switch (step) {
      case 'pick': return '接入 IM 平台'
      case 'plugin-install': return '安装插件'
      case 'guide': return `设置 ${platform?.label ?? ''}`
      case 'credentials': return '输入凭据'
      case 'verify': return '验证连接'
      case 'options': return '高级选项'
      case 'save': return '保存配置'
      case 'done': return '完成'
      case 'ai-creds': return `${platform?.label ?? ''} 登录信息`
    }
  }

  return (
    <div style={overlayStyle}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>

      {/* Header */}
      <div style={headerStyle}>
        {step !== 'done' && (
          <div onClick={handleBack} style={backBtn}>
            <ArrowLeft size={18} />
          </div>
        )}
        <h2 style={{ fontSize: 17, fontWeight: 600, color: '#fff', margin: 0 }}>
          {stepTitle()}
        </h2>
      </div>

      {/* Content */}
      <div style={contentStyle}>

        {/* ── Pick Platform ── */}
        {step === 'pick' && (
          <div>
            <p style={subtitleStyle}>
              选择要接入的 IM 平台
            </p>
            {IM_PLATFORMS.map(p => {
              const icon = platformIcons[p.id]
              return (
                <div key={p.id} onClick={() => handlePickPlatform(p)} style={{
                  ...rowStyle,
                  opacity: p.comingSoon ? 0.45 : 1,
                  cursor: p.comingSoon ? 'default' : 'pointer',
                }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 12,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: icon?.color ?? 'rgba(255,255,255,0.08)',
                    fontSize: 20, flexShrink: 0,
                  }}>
                    {icon?.emoji ?? p.label[0]}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 500, color: '#fff', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {p.label}
                      <span style={{
                        fontSize: 10, padding: '1px 6px', borderRadius: 6,
                        background: p.comingSoon ? 'rgba(255,255,255,0.06)' : p.builtin ? 'rgba(34,211,238,0.12)' : 'rgba(0,214,185,0.12)',
                        color: p.comingSoon ? 'rgba(255,255,255,0.3)' : p.builtin ? '#22d3ee' : '#00d6b9', fontWeight: 500,
                      }}>
                        {p.comingSoon ? '即将推出' : p.builtin ? '内置' : '插件'}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                      {p.description}
                    </div>
                  </div>
                  {!p.comingSoon && <ChevronRight size={16} style={{ color: 'rgba(255,255,255,0.2)', flexShrink: 0 }} />}
                </div>
              )
            })}
          </div>
        )}

        {/* ── Plugin Install (Feishu / DingTalk) ── */}
        {step === 'plugin-install' && platform && (platform.id === 'feishu' || platform.id === 'dingtalk') && (
          <div>
            <div style={infoBoxStyle(platform.color)}>
              <Bot size={16} style={{ color: platform.color, flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{platform.label}需要安装插件</div>
                <div>{platform.label}通道需要安装 OpenClaw {platform.label}插件。插件已预置在系统中，点击下方按钮即可自动安装。</div>
              </div>
            </div>

            {error && <ErrorBox message={error} />}

            {pluginInstalled ? (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 14px', borderRadius: 10, marginBottom: 16,
                background: 'rgba(34,197,94,0.08)',
                border: '1px solid rgba(34,197,94,0.15)',
              }}>
                <CheckCircle2 size={14} style={{ color: '#34d399' }} />
                <span style={{ fontSize: 13, color: '#34d399' }}>插件安装成功</span>
              </div>
            ) : (
              <div
                onClick={pluginInstalling ? undefined : handleInstallPlugin}
                style={{
                  ...primaryBtn,
                  opacity: pluginInstalling ? 0.6 : 1,
                  pointerEvents: pluginInstalling ? 'none' : 'auto',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {pluginInstalling ? (
                  <>
                    <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                    正在安装...
                  </>
                ) : (
                  <>
                    <Bot size={16} />
                    安装{platform.label}插件
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Guide Step ── */}
        {step === 'guide' && platform && (
          <div>
            <div style={infoBoxStyle(platform.color)}>
              <MessageSquare size={16} style={{ color: platform.color, flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>创建 {platform.label} Bot</div>
                <div>{getGuideText(platform.id)}</div>
              </div>
            </div>

            <div style={{ marginTop: 16, padding: 16, borderRadius: 12, background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.6)', marginBottom: 12 }}>
                操作步骤：
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {getGuideSteps(platform.id).map((text, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{
                      width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                      background: `${platform.color}22`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 600, color: platform.color,
                    }}>
                      {i + 1}
                    </div>
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6, paddingTop: 2 }}>{text}</span>
                  </div>
                ))}
              </div>
            </div>

            <div
              onClick={() => openExternal(platform.setupUrl)}
              style={{
                ...primaryBtn,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                marginTop: 20,
                background: platform.color,
              }}
            >
              <ExternalLink size={16} />
              在浏览器中打开
            </div>

            <div
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(platform.setupUrl)
                } catch {
                  const ta = document.createElement('textarea')
                  ta.value = platform.setupUrl
                  ta.style.cssText = 'position:fixed;opacity:0'
                  document.body.appendChild(ta)
                  ta.select()
                  document.execCommand('copy')
                  document.body.removeChild(ta)
                }
                setUrlCopied(true)
                setTimeout(() => setUrlCopied(false), 2000)
              }}
              style={{
                ...secondaryBtn,
                marginTop: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: urlCopied ? 'rgba(34,197,94,0.1)' : undefined,
                borderColor: urlCopied ? 'rgba(34,197,94,0.2)' : undefined,
                color: urlCopied ? '#34d399' : undefined,
              }}
            >
              {urlCopied ? <Check size={14} /> : <Copy size={14} />}
              {urlCopied ? '已复制到剪贴板' : '复制链接'}
            </div>

            {/* Divider */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, marginTop: 20, marginBottom: 4,
            }}>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', whiteSpace: 'nowrap' }}>或者</span>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
            </div>

            {/* AI Auto-Setup Button */}
            {onAISetup && (
              <div
                onClick={() => onAISetup(platform.id)}
                style={{
                  marginTop: 4,
                  padding: '14px 20px',
                  borderRadius: 14,
                  background: 'linear-gradient(135deg, rgba(34,211,238,0.15), rgba(168,85,247,0.15))',
                  border: '1px solid rgba(34,211,238,0.25)',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  fontSize: 14, fontWeight: 600,
                  color: '#22d3ee',
                  transition: 'all 0.2s',
                }}
              >
                <Sparkles size={18} />
                让 AI 帮我自动配置
              </div>
            )}

            <div
              onClick={() => setStep('credentials')}
              style={{
                ...secondaryBtn,
                marginTop: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              已创建，输入凭据
              <ChevronRight size={16} />
            </div>
          </div>
        )}

        {/* ── Credentials Input ── */}
        {step === 'credentials' && platform && (
          <div>
            <div style={infoBoxStyle('#22d3ee')}>
              <Send size={16} style={{ color: '#22d3ee', flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
                凭据仅保存在本设备上，不会上传到任何服务器
              </span>
            </div>

            {error && <ErrorBox message={error} />}

            {platform.credentialFields.map(field => (
              <div key={field.key} style={{ marginBottom: 20 }}>
                <label style={labelStyle}>
                  <Hash size={14} style={{ marginRight: 6 }} />
                  {field.label}
                </label>
                <input
                  type="text"
                  value={credentials[field.key] ?? ''}
                  onChange={e => handleCredentialChange(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  autoComplete="off"
                  style={inputStyle}
                />
              </div>
            ))}

            <div
              onClick={allCredentialsFilled ? handleVerify : undefined}
              style={{
                ...primaryBtn,
                opacity: allCredentialsFilled && !verifying ? 1 : 0.4,
                pointerEvents: allCredentialsFilled && !verifying ? 'auto' : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {verifying ? (
                <>
                  <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                  验证中...
                </>
              ) : (
                <>
                  <Check size={16} />
                  验证连接
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Options ── */}
        {step === 'options' && platform && (
          <div>
            {/* Verify success banner */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 14px', borderRadius: 10, marginBottom: 16,
              background: 'rgba(34,197,94,0.08)',
              border: '1px solid rgba(34,197,94,0.15)',
            }}>
              <CheckCircle2 size={14} style={{ color: '#34d399' }} />
              <span style={{ fontSize: 13, color: '#34d399' }}>{verifyResult}</span>
            </div>

            {/* Discord invite link */}
            {platform.id === 'discord' && discordAppId && (
              <div style={{ marginBottom: 20 }}>
                <div style={infoBoxStyle('#5865f2')}>
                  <MessageSquare size={16} style={{ color: '#5865f2', flexShrink: 0, marginTop: 1 }} />
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>邀请 Bot 到服务器</div>
                    <div>点击下方按钮复制邀请链接，在浏览器中打开并选择要添加 Bot 的服务器</div>
                  </div>
                </div>
                <div
                  onClick={handleCopyInvite}
                  style={{
                    ...secondaryBtn,
                    marginTop: 8,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    background: copied ? 'rgba(34,197,94,0.1)' : 'rgba(88,101,242,0.1)',
                    borderColor: copied ? 'rgba(34,197,94,0.2)' : 'rgba(88,101,242,0.2)',
                    color: copied ? '#34d399' : '#5865f2',
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? '已复制' : '复制邀请链接'}
                </div>
              </div>
            )}

            <div style={{ padding: 16, borderRadius: 12, background: 'rgba(255,255,255,0.02)', marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>
                默认配置
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', lineHeight: 1.6 }}>
                {getDefaultOptionsText(platform.id)}
              </div>
            </div>

            {error && <ErrorBox message={error} />}

            <div
              onClick={saving ? undefined : handleSave}
              style={{
                ...primaryBtn,
                opacity: saving ? 0.6 : 1,
                pointerEvents: saving ? 'none' : 'auto',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {saving ? (
                <>
                  <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                  保存并重启 Gateway...
                </>
              ) : (
                <>
                  <Check size={16} />
                  保存并完成
                </>
              )}
            </div>
          </div>
        )}

        {/* ── AI Credentials Collection ── */}
        {step === 'ai-creds' && platform && (
          <div>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6, margin: '0 0 16px' }}>
              自动配置需要你的 {platform.label} 登录信息。凭据仅临时保存在设备上，完成后自动删除。
            </p>

            {error && <ErrorBox message={error} />}

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>
                邮箱地址
              </label>
              <input
                type="email"
                value={aiCredsEmail}
                onChange={(e) => setAiCredsEmail(e.target.value)}
                placeholder="your@email.com"
                autoComplete="off"
                autoFocus
                style={{
                  width: '100%', padding: '12px 14px', borderRadius: 10,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                  color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>
                密码
              </label>
              <input
                type="password"
                value={aiCredsPassword}
                onChange={(e) => setAiCredsPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="off"
                style={{
                  width: '100%', padding: '12px 14px', borderRadius: 10,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                  color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>

            <div
              onClick={async () => {
                if (!aiCredsEmail.trim() || !aiCredsPassword.trim()) {
                  setError('请填写邮箱和密码')
                  return
                }
                setAiCredsSaving(true)
                setError('')
                try {
                  const credsFile = '/data/local/tmp/clawos/.im-setup-creds'
                  if (isAndroid && ClawOSBridge) {
                    await ClawOSBridge.writeTextFile({
                      path: credsFile,
                      content: JSON.stringify({ email: aiCredsEmail.trim(), password: aiCredsPassword.trim() }),
                    })
                  }
                  if (onAISetup) {
                    onAISetup(platform.id, credsFile)
                  }
                } catch (err: any) {
                  setError(err?.message || '保存凭据失败')
                  setAiCredsSaving(false)
                }
              }}
              style={{
                ...primaryBtn,
                opacity: aiCredsEmail.trim() && aiCredsPassword.trim() && !aiCredsSaving ? 1 : 0.4,
                pointerEvents: aiCredsEmail.trim() && aiCredsPassword.trim() && !aiCredsSaving ? 'auto' : 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {aiCredsSaving ? (
                <>
                  <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                  正在启动...
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  开始自动配置
                </>
              )}
            </div>

            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', marginTop: 12, textAlign: 'center' }}>
              如果你还没有 {platform.label} 账号，请先在手机或电脑上注册
            </p>
          </div>
        )}

        {/* ── Done ── */}
        {step === 'done' && platform && (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%', margin: '0 auto 20px',
              background: `${platform.color}22`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <CheckCircle2 size={32} style={{ color: platform.color }} />
            </div>
            <h3 style={{ fontSize: 20, fontWeight: 600, color: '#fff', margin: '0 0 8px' }}>
              {platform.label} 已接入
            </h3>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', margin: '0 0 32px' }}>
              Gateway 已重启，{platform.label} 通道将在几秒内连接
            </p>
            <div onClick={handleDone} style={primaryBtn}>
              完成
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '10px 14px', borderRadius: 10, marginBottom: 16,
      background: 'rgba(239,68,68,0.1)', color: '#f87171', fontSize: 13,
    }}>
      <AlertTriangle size={14} />
      {message}
    </div>
  )
}

// ── Guide Content ──────────────────────────────────────────────

function getGuideText(platformId: string): string {
  switch (platformId) {
    case 'telegram':
      return '在 Telegram 中找到 @BotFather，发送 /newbot 命令创建一个新 Bot，然后复制生成的 Token。'
    case 'discord':
      return '在 Discord Developer Portal 创建一个 Application，然后在 Bot 页面 Reset Token 并复制。'
    case 'slack':
      return '在 Slack API 控制台创建 App，启用 Socket Mode，添加 Event Subscriptions，然后获取 Bot Token 和 App Token。'
    case 'feishu':
      return '在飞书开放平台创建企业自建应用，添加机器人能力，然后获取 App ID 和 App Secret。'
    case 'dingtalk':
      return '在钉钉开放平台创建企业内部应用，添加机器人能力，然后获取 Client ID 和 Client Secret。'
    default:
      return ''
  }
}

function getGuideSteps(platformId: string): string[] {
  switch (platformId) {
    case 'telegram':
      return [
        '在 Telegram 中搜索并打开 @BotFather',
        '发送 /newbot 命令',
        '按提示输入 Bot 名称和用户名',
        '复制 BotFather 返回的 Token',
      ]
    case 'discord':
      return [
        '打开 Discord Developer Portal',
        '点击 "New Application" 创建应用',
        '进入 Bot 页面，点击 "Reset Token"',
        '复制生成的 Bot Token',
        '在 Bot 设置中启用 "Message Content Intent"',
      ]
    case 'slack':
      return [
        '打开 Slack API 控制台，点击 "Create New App"',
        '选择 "From scratch"，输入名称并选择 Workspace',
        '在 "Socket Mode" 中启用并创建 App-Level Token (xapp-)',
        '在 "Event Subscriptions" 中启用并添加 message.im 事件',
        '在 "OAuth & Permissions" 中安装到 Workspace，复制 Bot Token (xoxb-)',
      ]
    case 'feishu':
      return [
        '登录飞书开放平台',
        '创建企业自建应用',
        '在 "应用能力" 中添加 "机器人"',
        '在 "凭证与基础信息" 中复制 App ID 和 App Secret',
        '发布应用并添加到目标群组',
      ]
    case 'dingtalk':
      return [
        '登录钉钉开放平台 (open.dingtalk.com)',
        '创建企业内部应用（应用开发 → 企业内部开发）',
        '在 "应用能力" 中添加 "机器人"',
        '在 "凭证与基础信息" 中复制 Client ID 和 Client Secret',
        '发布应用版本',
      ]
    default:
      return []
  }
}

function getDefaultOptionsText(platformId: string): string {
  switch (platformId) {
    case 'telegram':
      return 'DM 策略: pairing (仅配对用户可 DM)\n群组: 需要 @提及才回复'
    case 'discord':
      return 'DM 策略: pairing (仅配对用户可 DM)\n服务器: 需要 @提及才回复'
    case 'slack':
      return '连接模式: Socket Mode (无需公网 URL)\nDM 策略: pairing'
    case 'feishu':
      return '域名: 飞书 (feishu.cn)\nDM 策略: pairing (仅配对用户可 DM)'
    case 'dingtalk':
      return '连接模式: Stream (无需公网 URL)\nDM 策略: pairing (仅配对用户可 DM)'
    default:
      return ''
  }
}

// ── Config Builder ─────────────────────────────────────────────

function buildChannelConfig(platform: IMChannelInfo, creds: Record<string, string>): Record<string, unknown> {
  const base: Record<string, unknown> = { enabled: true }

  switch (platform.id) {
    case 'telegram':
      return {
        ...base,
        botToken: creds.botToken.trim(),
        dmPolicy: 'pairing',
        groups: { '*': { requireMention: true } },
      }
    case 'discord':
      return {
        ...base,
        token: creds.token.trim(),
        dmPolicy: 'pairing',
        guilds: { '*': { requireMention: true } },
      }
    case 'slack':
      return {
        ...base,
        botToken: creds.botToken.trim(),
        appToken: creds.appToken?.trim(),
        dmPolicy: 'pairing',
      }
    case 'feishu':
      return {
        ...base,
        dmPolicy: 'pairing',
        accounts: {
          main: {
            appId: creds.appId.trim(),
            appSecret: creds.appSecret.trim(),
          },
        },
      }
    case 'dingtalk':
      return {
        ...base,
        clientId: creds.clientId.trim(),
        clientSecret: creds.clientSecret.trim(),
        dmPolicy: 'pairing',
      }
    default:
      return base
  }
}

// ── Shared Styles ──────────────────────────────────────────────

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 920,
  background: 'linear-gradient(180deg, #1a1d2e 0%, #12141f 100%)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}

const headerStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '16px 16px 12px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  flexShrink: 0,
}

const contentStyle: CSSProperties = {
  flex: 1, overflowY: 'auto', padding: 16,
  WebkitOverflowScrolling: 'touch' as any,
}

const backBtn: CSSProperties = {
  width: 36, height: 36, borderRadius: '50%',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'rgba(255,255,255,0.06)',
  color: 'rgba(255,255,255,0.6)',
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
}

const rowStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '12px 14px', borderRadius: 14,
  background: 'rgba(255,255,255,0.03)',
  marginBottom: 8, cursor: 'pointer',
  transition: 'background 0.15s',
}

const subtitleStyle: CSSProperties = {
  fontSize: 13, color: 'rgba(255,255,255,0.4)', margin: '0 0 16px',
}

const labelStyle: CSSProperties = {
  display: 'flex', alignItems: 'center',
  fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.5)',
  marginBottom: 8,
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '14px 16px',
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.04)',
  color: '#fff',
  fontSize: 15,
  fontFamily: 'monospace',
  outline: 'none',
  boxSizing: 'border-box',
  WebkitAppearance: 'none' as any,
}

const primaryBtn: CSSProperties = {
  width: '100%',
  padding: '14px',
  borderRadius: 14,
  border: 'none',
  background: 'linear-gradient(135deg, #22d3ee, #6366f1)',
  color: '#fff',
  fontSize: 15,
  fontWeight: 600,
  textAlign: 'center',
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
}

const secondaryBtn: CSSProperties = {
  width: '100%',
  padding: '12px',
  borderRadius: 14,
  border: '1px solid rgba(255,255,255,0.1)',
  background: 'rgba(255,255,255,0.03)',
  color: 'rgba(255,255,255,0.7)',
  fontSize: 14,
  fontWeight: 500,
  textAlign: 'center',
  cursor: 'pointer',
  WebkitTapHighlightColor: 'transparent',
}

function infoBoxStyle(color: string): CSSProperties {
  return {
    display: 'flex', alignItems: 'flex-start', gap: 10,
    padding: '12px 14px', borderRadius: 12,
    background: `${color}0F`,
    border: `1px solid ${color}1F`,
    marginBottom: 20,
  }
}
