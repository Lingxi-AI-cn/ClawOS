import { create } from 'zustand'

export interface IMChannelInfo {
  id: string
  label: string
  description: string
  color: string
  credentialFields: { key: string; label: string; placeholder: string; prefix?: string }[]
  builtin: boolean
  setupUrl: string
  verifyUrl?: string
  comingSoon?: boolean
}

export const IM_PLATFORMS: IMChannelInfo[] = [
  {
    id: 'telegram',
    label: 'Telegram',
    description: 'Telegram Bot — 仅需一个 Bot Token',
    color: '#26a5e4',
    credentialFields: [
      { key: 'botToken', label: 'Bot Token', placeholder: '123456:ABC-DEF...' },
    ],
    builtin: true,
    setupUrl: 'https://t.me/BotFather',
    verifyUrl: 'https://api.telegram.org/bot{token}/getMe',
  },
  {
    id: 'discord',
    label: 'Discord',
    description: 'Discord Bot — 需要 Bot Token',
    color: '#5865f2',
    credentialFields: [
      { key: 'token', label: 'Bot Token', placeholder: 'MTIz...' },
    ],
    builtin: true,
    setupUrl: 'https://discord.com/developers/applications',
    verifyUrl: 'https://discord.com/api/v10/users/@me',
  },
  {
    id: 'slack',
    label: 'Slack',
    description: 'Slack Bot — 需要 Bot Token + App Token',
    color: '#4a154b',
    credentialFields: [
      { key: 'botToken', label: 'Bot Token', placeholder: 'xoxb-...', prefix: 'xoxb-' },
      { key: 'appToken', label: 'App Token', placeholder: 'xapp-...', prefix: 'xapp-' },
    ],
    builtin: true,
    setupUrl: 'https://api.slack.com/apps',
  },
  {
    id: 'feishu',
    label: '飞书 / Lark',
    description: '飞书机器人 — 需要 App ID + App Secret',
    color: '#00d6b9',
    credentialFields: [
      { key: 'appId', label: 'App ID', placeholder: 'cli_xxx...' },
      { key: 'appSecret', label: 'App Secret', placeholder: '' },
    ],
    builtin: false,
    setupUrl: 'https://open.feishu.cn/app',
  },
  {
    id: 'dingtalk',
    label: '钉钉',
    description: '钉钉机器人 — 需要 Client ID + Client Secret',
    color: '#0089ff',
    credentialFields: [
      { key: 'clientId', label: 'Client ID', placeholder: 'ding...' },
      { key: 'clientSecret', label: 'Client Secret', placeholder: '' },
    ],
    builtin: false,
    setupUrl: 'https://open.dingtalk.com/',
    comingSoon: true,
  },
]

interface IMChannelState {
  isWizardOpen: boolean
  openWizard: () => void
  closeWizard: () => void
}

export const useIMChannelStore = create<IMChannelState>((set) => ({
  isWizardOpen: false,
  openWizard: () => set({ isWizardOpen: true }),
  closeWizard: () => set({ isWizardOpen: false }),
}))
