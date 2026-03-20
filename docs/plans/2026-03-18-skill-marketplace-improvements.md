# Skill Marketplace 改进实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 改进 Skill 市场，支持显示 top 100 skills、中文翻译、兼容性过滤开关和安装警告

**Architecture:** 后端集成免费翻译服务并在缓存中存储翻译结果，前端添加过滤开关和自定义警告弹窗，翻译失败时使用原文作为 fallback

**Tech Stack:** Node.js, Express, @vitalets/google-translate-api, React, TypeScript

---

## Task 1: 后端 - 安装翻译依赖

**Files:**
- Modify: `skill-service/package.json`

**Step 1: 安装翻译包**

```bash
cd /opt/ClawOS/skill-service
npm install @vitalets/google-translate-api
```

Expected: Package installed successfully

**Step 2: 验证安装**

```bash
npm list @vitalets/google-translate-api
```

Expected: 显示包版本信息

**Step 3: Commit**

```bash
git add skill-service/package.json skill-service/package-lock.json
git commit -m "feat(skill-service): add google-translate-api dependency"
```

---

## Task 2: 后端 - 添加翻译函数

**Files:**
- Modify: `skill-service/server.mjs:1-10` (import section)
- Modify: `skill-service/server.mjs:66-67` (after analyzeCompatibility function)

**Step 1: 添加 import**

在 `server.mjs` 第 7 行后添加：

```javascript
import translate from '@vitalets/google-translate-api'
```

**Step 2: 添加翻译函数**

在 `analyzeCompatibility` 函数后（第 66 行后）添加：

```javascript
async function translateText(text) {
  try {
    const result = await translate(text, { to: 'zh-CN' })
    return { text: result.text, translated: true }
  } catch (error) {
    console.warn('Translation failed:', error.message)
    return { text, translated: false }
  }
}
```

**Step 3: 测试翻译函数**

创建临时测试文件验证：

```bash
cd /opt/ClawOS/skill-service
node -e "import('./server.mjs').then(() => console.log('Import successful'))"
```

Expected: No syntax errors

**Step 4: Commit**

```bash
git add skill-service/server.mjs
git commit -m "feat(skill-service): add translateText function with fallback"
```

---

## Task 3: 后端 - 移除兼容性过滤

**Files:**
- Modify: `skill-service/server.mjs:113`

**Step 1: 修改过滤逻辑**

将第 113 行：

```javascript
const skills = results.filter(s => s && s.compatibility.compatible)
```

改为：

```javascript
const skills = results.filter(s => s !== null)
```

**Step 2: 验证语法**

```bash
node -e "import('./server.mjs').then(() => console.log('Syntax OK'))"
```

Expected: "Syntax OK"

**Step 3: Commit**

```bash
git add skill-service/server.mjs
git commit -m "feat(skill-service): remove compatibility filtering"
```

---

## Task 4: 后端 - 增加 limit 到 100

**Files:**
- Modify: `skill-service/server.mjs:90`

**Step 1: 修改 limit**

将第 90 行：

```javascript
const inspectPromises = slugs.slice(0, 20).map(async slug => {
```

改为：

```javascript
const inspectPromises = slugs.slice(0, 100).map(async slug => {
```

**Step 2: Commit**

```bash
git add skill-service/server.mjs
git commit -m "feat(skill-service): increase skill limit to 100"
```

---

## Task 5: 后端 - 集成翻译到返回对象

**Files:**
- Modify: `skill-service/server.mjs:90-110`

**Step 1: 添加翻译调用**

在第 98 行（`const compat = analyzeCompatibility(text)` 后）添加：

```javascript
const translated = await translateText(skill.summary || '')
```

**Step 2: 修改返回对象**

将返回对象（第 100-106 行）修改为：

```javascript
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

**Step 3: 测试后端**

```bash
# 启动服务
npm start &
SERVER_PID=$!

# 等待启动
sleep 3

# 测试 API
curl http://localhost:3000/api/skills | jq '.[0] | {slug, descriptionZh, translated}'

# 停止服务
kill $SERVER_PID
```

Expected: 返回包含 `descriptionZh` 和 `translated` 字段的 JSON

**Step 4: Commit**

```bash
git add skill-service/server.mjs
git commit -m "feat(skill-service): integrate translation into skill response"
```

---

## Task 6: 前端 - 更新 TypeScript 接口

**Files:**
- Modify: `ui/src/components/SkillMarketplace.tsx:6-16`

**Step 1: 更新 Skill 接口**

将接口（第 6-16 行）修改为：

```typescript
interface Skill {
  slug: string
  name: string
  description: string
  descriptionZh: string
  translated: boolean
  downloads: number
  compatibility: {
    score: number
    compatible: boolean
    issues: string[]
    level: string
  }
}
```

**Step 2: 验证 TypeScript**

```bash
cd /opt/ClawOS/ui
npx tsc --noEmit
```

Expected: No type errors

**Step 3: Commit**

```bash
git add ui/src/components/SkillMarketplace.tsx
git commit -m "feat(ui): update Skill interface with translation fields"
```

---

## Task 7: 前端 - 添加状态管理

**Files:**
- Modify: `ui/src/components/SkillMarketplace.tsx:18-22`

**Step 1: 添加新状态**

在第 21 行后添加：

```typescript
const [filterEnabled, setFilterEnabled] = useState(false)
const [warningSkill, setWarningSkill] = useState<Skill | null>(null)
```

**Step 2: 验证编译**

```bash
npx tsc --noEmit
```

Expected: No errors

**Step 3: Commit**

```bash
git add ui/src/components/SkillMarketplace.tsx
git commit -m "feat(ui): add filter and warning state management"
```

---

## Task 8: 前端 - 添加过滤开关 UI

**Files:**
- Modify: `ui/src/components/SkillMarketplace.tsx:81-94`

**Step 1: 修改搜索框容器**

将第 82 行的 `<div style={{ padding: 16 }}>` 改为：

```typescript
<div style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
```

**Step 2: 在输入框后添加过滤开关**

在第 93 行（`/>` 后）添加：

```typescript
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
```

**Step 3: 验证编译**

```bash
npx tsc --noEmit
```

Expected: No errors

**Step 4: Commit**

```bash
git add ui/src/components/SkillMarketplace.tsx
git commit -m "feat(ui): add compatibility filter toggle"
```

---

## Task 9: 前端 - 实现过滤逻辑

**Files:**
- Modify: `ui/src/components/SkillMarketplace.tsx:52-55`

**Step 1: 修改过滤逻辑**

将第 52-55 行的 `filtered` 定义修改为：

```typescript
const filtered = skills
  .filter(s => filterEnabled ? s.compatibility.score >= 60 : true)
  .filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.descriptionZh.toLowerCase().includes(search.toLowerCase())
  )
```

**Step 2: 验证编译**

```bash
npx tsc --noEmit
```

Expected: No errors

**Step 3: Commit**

```bash
git add ui/src/components/SkillMarketplace.tsx
git commit -m "feat(ui): implement compatibility filtering logic"
```

---

## Task 10: 前端 - 添加警告弹窗组件

**Files:**
- Modify: `ui/src/components/SkillMarketplace.tsx:57-139` (在 return 的 div 内部最后添加)

**Step 1: 在主容器末尾添加弹窗**

在第 137 行（`</div>` 前，skills list 的 div 后）添加：

```typescript
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
        此 Skill 可能不完全兼容 Android 环境（兼容性评分: {warningSkill.compatibility.score}%）
      </p>
      {warningSkill.compatibility.issues.length > 0 && (
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
```

**Step 2: 验证编译**

```bash
npx tsc --noEmit
```

Expected: No errors

**Step 3: Commit**

```bash
git add ui/src/components/SkillMarketplace.tsx
git commit -m "feat(ui): add compatibility warning modal"
```

---

## Task 11: 前端 - 修改安装逻辑

**Files:**
- Modify: `ui/src/components/SkillMarketplace.tsx:30-50` (在 installSkill 前添加 handleInstall)

**Step 1: 添加 handleInstall 函数**

在 `installSkill` 函数前（第 30 行前）添加：

```typescript
const handleInstall = (skill: Skill) => {
  if (skill.compatibility.score < 60) {
    setWarningSkill(skill)
  } else {
    installSkill(skill.slug)
  }
}
```

**Step 2: 修改按钮 onClick**

找到安装按钮（约第 123 行），将：

```typescript
onClick={() => installSkill(skill.slug)}
```

改为：

```typescript
onClick={() => handleInstall(skill)}
```

**Step 3: 验证编译**

```bash
npx tsc --noEmit
```

Expected: No errors

**Step 4: Commit**

```bash
git add ui/src/components/SkillMarketplace.tsx
git commit -m "feat(ui): add compatibility check before installation"
```

---

## Task 12: 前端 - 显示中文描述

**Files:**
- Modify: `ui/src/components/SkillMarketplace.tsx:106-108`

**Step 1: 修改描述显示**

将第 106-108 行：

```typescript
<p style={{ margin: '4px 0', fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
  {skill.description}
</p>
```

改为：

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

**Step 2: 验证编译**

```bash
npx tsc --noEmit
```

Expected: No errors

**Step 3: Commit**

```bash
git add ui/src/components/SkillMarketplace.tsx
git commit -m "feat(ui): display Chinese description with translation status"
```

---

## Task 13: 构建和测试

**Files:**
- Test: All modified files

**Step 1: 构建前端**

```bash
cd /opt/ClawOS/ui
pnpm run build
```

Expected: Build successful

**Step 2: 启动 Skill Service**

```bash
cd /opt/ClawOS/skill-service
npm start &
SERVICE_PID=$!
```

**Step 3: 测试 API 端点**

```bash
# 测试获取 skills
curl http://localhost:3000/api/skills | jq 'length'
# Expected: 接近 100

# 测试翻译字段
curl http://localhost:3000/api/skills | jq '.[0] | {descriptionZh, translated}'
# Expected: 包含中文描述和翻译状态

# 测试兼容性数据
curl http://localhost:3000/api/skills | jq '[.[] | select(.compatibility.score < 60)] | length'
# Expected: > 0 (有低兼容性的 skills)
```

**Step 4: 停止服务**

```bash
kill $SERVICE_PID
```

**Step 5: 手动测试清单**

在设备上测试：
- [ ] Skill 市场显示约 100 个 skills
- [ ] 描述显示为中文（或标记"原文"）
- [ ] 过滤开关可以切换
- [ ] 过滤开关启用时只显示兼容性 ≥60% 的 skills
- [ ] 安装低兼容性 skill 时显示警告弹窗
- [ ] 警告弹窗显示具体兼容性问题
- [ ] 点击"取消"关闭弹窗
- [ ] 点击"继续安装"执行安装
- [ ] 搜索功能正常（支持中文搜索）

**Step 6: 最终 Commit**

```bash
git add -A
git commit -m "test: verify skill marketplace improvements"
```

---

## 验收标准

- [ ] 后端返回 top 100 skills（不过滤）
- [ ] 每个 skill 包含 `descriptionZh` 和 `translated` 字段
- [ ] 翻译失败时使用原文
- [ ] 前端显示中文描述
- [ ] 过滤开关可以切换显示/隐藏低兼容性 skills
- [ ] 安装低兼容性 skill 时显示警告弹窗
- [ ] 警告弹窗显示具体兼容性问题列表
- [ ] 所有功能在 Android 设备上正常工作

---

## 回滚计划

如果出现问题：

```bash
# 回滚所有改动
git log --oneline -13  # 查看最近 13 个 commits
git reset --hard HEAD~13

# 或者回滚到特定 commit
git reset --hard <commit-hash>
```
