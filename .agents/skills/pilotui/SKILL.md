---
name: PilotUI
description: Comprehensive UI component library for Vue 3.
documentation: https://codebridger.github.io/lib-vue-components/llm.md
---

# PilotUI Professional Component Library

PilotUI is a Vue 3 component library built for speed and aesthetics. This skill documents its core components and specific usage patterns for this project.

## 🚀 Correct Usage Pattern

**IMPORTANT**: Do NOT register the library globally with a prefix. Instead, use independent, named imports for each component you need. This keeps the bundle size small and the code explicit.

### [DO] Independent Imports
```vue
<script setup lang="ts">
import { Button, Card, Modal } from 'pilotui'
import 'pilotui/style.css' // Include styles in your main.ts or root component
</script>

<template>
  <Card>
    <h3>Hello World</h3>
    <Button variant="primary">Click Me</Button>
  </Card>
</template>
```

### [DON'T] Global Registration
```typescript
// AVOID THIS
import vueComponents from 'pilotui'
app.use(vueComponents, { prefix: 'CL' })
```

---
## 🛠 Full Component List

Based on the official PilotUI documentation, here are the available components categorized by their functionality:

### Shell & Layout
- `AppRoot`
- `DashboardShell`
- `HorizontalMenu`
- `SidebarMenu`

### Elements & Basic UI
- `Avatar`
- `AvatarGroup`
- `Button`
- `Card`
- `Dropdown`
- `IconButton`
- `Progress`
- `Tabs`
- `Tooltip`

### Forms & Inputs
- `Input`
- `InputGroup`
- `Select`
- `CheckboxInput`
- `SwitchBall`
- `TextArea`
- `FileInputButton`
- `FileInputCombo`

### Complex UI
- `Modal`
- `Pagination`
- `DataTable`

### Utilities & Other
- `Toast` (Notification System)
- `Icon Gallery`
- `Icons` (Multi-pack icon support)

---

## 🎨 Visual System
- Built with Tailwind CSS compatibility.
- Uses Nunito Sans as the default font.
- Supports dark mode and premium glassmorphism effects.

---

## 📋 Source Documentation Reference
The following content is captured from the `llm.md` provided by the maintainers:

### Modals
Customizable modal component with various behaviors.
- **Custom Trigger**: Uses custom buttons instead of defaults.
- **Persistent**: Won't close on click-outside or escape.
- **Animations**: Supports zoom-in effects.

### Tabs
Tabs container with custom background styling applied via the `containerClass` prop.

### Progress & Status
Media headings and progress examples for interactive feedback.
