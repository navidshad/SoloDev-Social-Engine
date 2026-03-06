<script setup lang="ts">
import { IconButton, Icon } from 'pilotui/elements'
import { useAppStore } from 'pilotui/store'
import { computed } from 'vue'

const store = useAppStore()

const currentThemeIcon = computed(() => {
	if (store.theme === 'dark') return 'IconMoon'
	if (store.theme === 'light') return 'IconSun'
	return 'IconLaptop'
})

const cycleTheme = () => {
	const themes: ('light' | 'dark' | 'system')[] = ['light', 'dark', 'system']
	const currentIndex = themes.indexOf(store.theme as any)
	const nextIndex = (currentIndex + 1) % themes.length
	store.toggleTheme(themes[nextIndex])
}
</script>

<template>
	<IconButton @click="cycleTheme" size="xs" variant="outline" :icon="currentThemeIcon" />
</template>
