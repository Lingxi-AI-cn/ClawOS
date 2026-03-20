# UI 布局重新设计实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将功能入口图标从 HUD 移到 AIBrain 周围的圆弧布局，解决顶部状态栏拥挤问题

**Architecture:** 创建 FunctionOrbit 组件使用 CSS transform 实现圆弧定位，包裹 AIBrain 组件，HUD 简化为快速设置

**Tech Stack:** React 19.2, TypeScript 5.9, Motion (Framer Motion) 12, Lucide React

---

## Task 1: 创建 FunctionOrbit 组件

**Files:**
- Create: `ui/src/components/FunctionOrbit.tsx`

**Step 1: 创建组件文件**

创建 `ui/src/components/FunctionOrbit.tsx`：

```typescript
import { motion } from 'motion/react'
import { ArrowUpCircle, LayoutGrid, Package, MessageSquare } from 'lucide-react'

interface FunctionOrbitProps {
  onUpdateClick: () => void
  onAppsClick: () => void
  onSkillClick: () => void
  onIMClick: () => void
}

const getIconPosition = (angle: number, radius: number) => {
  const rad = (angle * Math.PI) / 180
  return {
    left: '50%',
    top: '50%',
    transform: `translate(-50%, -50%) translate(${Math.cos(rad) * radius}px, ${Math.sin(rad) * radius}px)`
  }
}

export default function FunctionOrbit({
  onUpdateClick,
  onAppsClick,
  onSkillClick,
  onIMClick
}: FunctionOrbitProps) {
  const isMobile = window.innerWidth < 768
  const radius = isMobile ? 120 : 140
  const iconSize = isMobile ? 32 : 40

  const icons = [
    { angle: 170, Icon: MessageSquare, onClick: onIMClick, label: 'IM 通道' },
    { angle: 190, Icon: Package, onClick: onSkillClick, label: 'Skill 市场' },
    { angle: 350, Icon: ArrowUpCircle, onClick: onUpdateClick, label: '在线升级' },
    { angle: 10, Icon: LayoutGrid, onClick: onAppsClick, label: '应用抽屉' }
  ]

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none'
    }}>
      {icons.map(({ angle, Icon, onClick, label }) => (
        <motion.button
          key={angle}
          onClick={onClick}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.95 }}
          style={{
            position: 'absolute',
            ...getIconPosition(angle, radius),
            width: iconSize,
            height: iconSize,
            borderRadius: '50%',
            border: 'none',
            background: 'rgba(255,255,255,0.1)',
            backdropFilter: 'blur(10px)',
            color: '#fff',
            cursor: 'pointer',
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
          }}
          aria-label={label}
        >
          <Icon size={iconSize * 0.6} />
        </motion.button>
      ))}
    </div>
  )
}
```

**Step 2: 验证 TypeScript 编译**

```bash
cd /opt/ClawOS/ui
npx tsc --noEmit
```

Expected: No type errors

**Step 3: Commit**

```bash
git add ui/src/components/FunctionOrbit.tsx
git commit -m "feat(ui): add FunctionOrbit component with circular arc layout"
```

---

## Task 2: 集成 FunctionOrbit 到 App.tsx

**Files:**
- Modify: `ui/src/App.tsx:1-10` (imports)
- Modify: `ui/src/App.tsx:589-602` (AIBrain section)

**Step 1: 添加 import**

在 `ui/src/App.tsx` 的 imports 区域添加：

```typescript
import FunctionOrbit from './components/FunctionOrbit'
```

**Step 2: 修改 AIBrain 布局**

找到 AIBrain 的 motion.div（约 line 589-602），修改为：

```typescript
<div style={{ position: 'relative', height: isMobile ? 150 : 180 }}>
  <FunctionOrbit
    onUpdateClick={() => setShowUpdateDialog(true)}
    onAppsClick={() => setShowAppDrawer(true)}
    onSkillClick={() => setShowSkillMarketplace(true)}
    onIMClick={() => setShowIMChannelDialog(true)}
  />
  <motion.div
    style={{
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}
    animate={sceneControls}
  >
    <AIBrain />
  </motion.div>
</div>
```

**Step 3: 验证编译**

```bash
cd /opt/ClawOS/ui
npx tsc --noEmit
```

Expected: No type errors

**Step 4: Commit**

```bash
git add ui/src/App.tsx
git commit -m "feat(ui): integrate FunctionOrbit around AIBrain"
```

---

## Task 3: 简化 HUD 组件

**Files:**
- Modify: `ui/src/components/HUD.tsx:224-307` (右侧区域)

**Step 1: 移除 4 个功能图标**

在 `ui/src/components/HUD.tsx` 的右侧区域（约 line 224-307），移除以下图标按钮：
- `ArrowUpCircle` (在线升级)
- `LayoutGrid` (应用抽屉)
- `Package` (Skill 市场)
- `MessageSquare` (IM 通道)

保留以下图标：
- `Settings` (设置)
- `Signal` (信号)
- `Wifi` (WiFi)
- `Battery` (电池)

**Step 2: 验证编译**

```bash
cd /opt/ClawOS/ui
npx tsc --noEmit
```

Expected: No type errors

**Step 3: Commit**

```bash
git add ui/src/components/HUD.tsx
git commit -m "feat(ui): simplify HUD by removing function icons"
```

---

## Task 4: 构建和验证

**Files:**
- Test: All modified files

**Step 1: 构建前端**

```bash
cd /opt/ClawOS/ui
pnpm run build
```

Expected: Build successful

**Step 2: 验证 TypeScript**

```bash
npx tsc --noEmit
```

Expected: No type errors

**Step 3: 视觉验证清单**

在浏览器或设备上测试：
- [ ] FunctionOrbit 图标显示在 AIBrain 周围
- [ ] 左侧 2 个图标：IM 通道、Skill 市场
- [ ] 右侧 2 个图标：在线升级、应用抽屉
- [ ] 图标圆弧排列对称美观
- [ ] HUD 只显示 4 个图标：Settings、Signal、WiFi、Battery
- [ ] 点击 FunctionOrbit 图标功能正常
- [ ] 悬停动画流畅
- [ ] 移动端响应式正常

**Step 4: 最终 Commit**

```bash
git add -A
git commit -m "feat(ui): complete UI layout redesign with FunctionOrbit"
```

---

## 验收标准

- [ ] FunctionOrbit 组件创建完成
- [ ] 4 个功能图标圆弧排列在 AIBrain 周围
- [ ] HUD 简化为快速设置（4 个图标）
- [ ] 响应式设计正常（移动/桌面）
- [ ] 所有点击功能正常
- [ ] TypeScript 编译无错误
- [ ] 前端构建成功
