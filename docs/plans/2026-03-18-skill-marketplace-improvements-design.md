# Skill Marketplace 改进设计

**日期**: 2026-03-18
**状态**: 已批准

## 需求概述

改进 ClawOS Skill 市场功能：

1. 不再自动过滤低兼容性 skills，改为显示 top 100
2. 显示兼容性评分标识
3. 安装低兼容性 skill 时显示警告弹窗
4. 提供过滤开关让用户选择是否过滤
5. 集成 Google 翻译，将 skill 描述翻译成中文

## 技术方案

**方案选择**: 容错翻译方案

- 使用免费翻译服务 `@vitalets/google-translate-api`
- 翻译失败时使用原文作为 fallback
- 在响应中增加 `translated` 标识
- 利用现有缓存机制（skills.json，1小时过期）

## 详细设计

### 一、后端改动（skill-service/server.mjs）

#### 1. 安装依赖
```bash
npm install @vitalets/google-translate-api
```

#### 2. 添加翻译函数
```javascript
import translate from '@vitalets/google-translate-api'

async function translateText(text) {
  try {
    const result = await translate(text, { to: 'zh-CN' })
    return { text: result.text, translated: true }
  } catch {
    return { text, translated: false }
  }
}
```

#### 3. 修改 GET /api/skills 端点

**a) 移除兼容性过滤（第 113 行）**
```javascript
// 修改前：
const skills = results.filter(s => s && s.compatibility.compatible)

// 修改后：
const skills = results.filter(s => s !== null)
```

**b) 增加 limit 到 100（第 90 行）**
```javascript
// 修改前：
const inspectPromises = slugs.slice(0, 20).map(async slug => {

// 修改后：
const inspectPromises = slugs.slice(0, 100).map(async slug => {
```

**c) 在返回对象中增加翻译字段**
```javascript
const translated = await translateText(skill.summary || '')

return {
  slug: skill.slug,
  name: skill.displayName || skill.slug,
  description: skill.summary || '',
  descriptionZh: translated.text,
  translated: translated.translated,
  downloads: skill.stats?.downloads || 0,
  compatibility: compat
}
```

### 二、前端改动（ui/src/components/SkillMarketplace.tsx）

#### 1. 更新 TypeScript 接口
```typescript
interface Skill {
  slug: string
  name: string
  description: string
  descriptionZh: string      // 新增：中文描述
  translated: boolean        // 新增：翻译状态
  downloads: number
  compatibility: {
    score: number
    compatible: boolean
    issues: string[]
    level: string
  }
}
```

#### 2. 添加状态管理
```typescript
const [filterEnabled, setFilterEnabled] = useState(false)
const [warningSkill, setWarningSkill] = useState<Skill | null>(null)
```

#### 3. 搜索框同行添加过滤开关
```typescript
<div style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
  <input type="text" placeholder="搜索 Skills..." ... />
  <label style={{
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    color: '#fff',
    fontSize: 14,
    whiteSpace: 'nowrap'
  }}>
    <input
      type="checkbox"
      checked={filterEnabled}
      onChange={e => setFilterEnabled(e.target.checked)}
    />
    仅兼容
  </label>
</div>
```

#### 4. 应用过滤逻辑
```typescript
const filtered = skills
  .filter(s => filterEnabled ? s.compatibility.score >= 60 : true)
  .filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.descriptionZh.toLowerCase().includes(search.toLowerCase())
  )
```

#### 5. 自定义警告弹窗组件
```typescript
{warningSkill && (
  <div style={{
    position: 'fixed',
    inset: 0,
    zIndex: 10000,
    background: 'rgba(0,0,0,0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  }}>
    <div style={{
      background: '#1f2937',
      borderRadius: 12,
      padding: 24,
      maxWidth: 400,
      width: '90%'
    }}>
      <h3 style={{ margin: '0 0 12px', color: '#fff' }}>兼容性警告</h3>
      <p style={{
        margin: '0 0 16px',
        color: 'rgba(255,255,255,0.7)',
        fontSize: 14
      }}>
        此 Skill 可能不完全兼容 Android 环境（兼容性评分: {warningSkill.compatibility.score}%）
      </p>
      <ul style={{
        margin: '0 0 16px',
        paddingLeft: 20,
        color: '#ef4444',
        fontSize: 13
      }}>
        {warningSkill.compatibility.issues.map((issue, i) => (
          <li key={i}>{issue}</li>
        ))}
      </ul>
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
            cursor: 'pointer'
          }}
        >
          取消
        </button>
        <button
          onClick={() => {
            setWarningSkill(null)
            installSkill(warningSkill.slug)
          }}
          style={{
            flex: 1,
            padding: 10,
            borderRadius: 8,
            border: 'none',
            background: '#3b82f6',
            color: '#fff',
            cursor: 'pointer'
          }}
        >
          继续安装
        </button>
      </div>
    </div>
  </div>
)}
```

#### 6. 修改安装逻辑
```typescript
const handleInstall = (skill: Skill) => {
  if (skill.compatibility.score < 60) {
    setWarningSkill(skill)
  } else {
    installSkill(skill.slug)
  }
}

// 在按钮中使用
<button onClick={() => handleInstall(skill)} ...>
```

#### 7. 显示中文描述
```typescript
<p style={{ margin: '4px 0', fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
  {skill.descriptionZh}
  {!skill.translated && (
    <span style={{ marginLeft: 4, fontSize: 11, color: '#6b7280' }}>
      (原文)
    </span>
  )}
</p>
```

## 实现要点

1. **翻译容错**: 翻译失败时使用原文，不影响功能
2. **缓存机制**: 翻译结果随 skill 数据一起缓存，避免重复翻译
3. **用户体验**:
   - 默认不过滤，显示所有 skills
   - 提供过滤开关让用户自主选择
   - 低兼容性 skill 安装前显示详细警告
4. **最小改动**: 利用现有架构，改动最小化

## 影响范围

- **后端**: `skill-service/server.mjs`
- **前端**: `ui/src/components/SkillMarketplace.tsx`
- **依赖**: 新增 `@vitalets/google-translate-api`

## 测试要点

1. 验证翻译功能正常工作
2. 验证翻译失败时使用原文
3. 验证过滤开关功能
4. 验证低兼容性警告弹窗
5. 验证缓存机制（1小时过期）
6. 验证显示 100 个 skills
