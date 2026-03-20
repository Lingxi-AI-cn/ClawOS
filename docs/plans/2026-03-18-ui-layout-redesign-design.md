# UI 布局重新设计

**日期**: 2026-03-18
**状态**: 已批准

## 需求概述

重新设计 ClawOS UI 布局，解决 HUD 顶部状态栏图标拥挤问题：

1. 将功能入口图标从 HUD 移出：在线升级 Gateway、IM 通道、Skill 市场、应用抽屉
2. 在 AIBrain 周围圆弧形排列这些图标
3. HUD 保留快速设置：Settings、Signal、WiFi、Battery
4. 设计美观、对称、不混乱

## 技术方案

**方案选择**: 圆弧布局方案

- 创建新组件 `FunctionOrbit.tsx` 包裹 AIBrain
- 使用 CSS transform 实现圆弧定位
- 左右对称排列 4 个功能图标
- 玻璃态样式 + Motion 动画
- 响应式设计（移动/桌面）

## 详细设计

### 一、新组件 FunctionOrbit

#### 组件结构
```typescript
interface FunctionOrbitProps {
  onUpdateClick: () => void
  onAppsClick: () => void
  onSkillClick: () => void
  onIMClick: () => void
}
```

#### 核心设计
- **容器**: 绝对定位，覆盖 AIBrain 区域，`pointerEvents: none`
- **图标**: 圆形按钮，`pointerEvents: auto`，玻璃态效果
- **布局**: 圆弧排列，左右对称
  - 左侧: IM 通道 (170°)、Skill 市场 (190°)
  - 右侧: 在线升级 (350°)、应用抽屉 (10°)

#### 图标样式
- **尺寸**: 40px (桌面) / 32px (移动)
- **半径**: 140px (桌面) / 120px (移动)
- **背景**: `rgba(255,255,255,0.1)` + `backdropFilter: blur(10px)`
- **动画**: `whileHover={{ scale: 1.1 }}`, `whileTap={{ scale: 0.95 }}`
- **阴影**: `0 4px 12px rgba(0,0,0,0.3)`

### 二、圆弧位置计算

```typescript
const getIconPosition = (angle: number, radius: number) => {
  const rad = (angle * Math.PI) / 180
  return {
    left: '50%',
    top: '50%',
    transform: `translate(-50%, -50%) translate(${Math.cos(rad) * radius}px, ${Math.sin(rad) * radius}px)`
  }
}
```

### 三、集成到现有布局

#### App.tsx 修改
- 在 AIBrain 外层包裹 `<div style={{ position: 'relative' }}>`
- 添加 `<FunctionOrbit />` 组件
- 传递 4 个回调函数

#### HUD.tsx 修改
- 移除右侧区域的 4 个图标：
  - `ArrowUpCircle` (在线升级)
  - `LayoutGrid` (应用抽屉)
  - `Package` (Skill 市场)
  - `MessageSquare` (IM 通道)
- 保留：`Settings`, `Signal`, `Wifi`, `Battery`

## 实现要点

1. **响应式设计**: 使用 `window.innerWidth < 768` 判断移动/桌面
2. **内联样式**: Android WebView 兼容性，关键布局使用内联样式
3. **Motion 动画**: 平滑的悬停和点击反馈
4. **可访问性**: 每个按钮添加 `aria-label`
5. **最小改动**: 只修改 3 个文件（新建 1 个，修改 2 个）

## 影响范围

- **新建**: `ui/src/components/FunctionOrbit.tsx`
- **修改**: `ui/src/App.tsx` (集成 FunctionOrbit)
- **修改**: `ui/src/components/HUD.tsx` (移除 4 个图标)

## 测试要点

1. 验证图标位置正确（左右对称）
2. 验证响应式行为（移动/桌面）
3. 验证点击功能正常（4 个对话框/抽屉）
4. 验证 HUD 简化后显示正常
5. 验证动画效果流畅
6. 验证 Android WebView 渲染正常
