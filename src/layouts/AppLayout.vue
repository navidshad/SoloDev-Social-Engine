<script setup lang="ts">
import { DashboardShell, SidebarMenu, Button } from 'pilotui'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const authStore = useAuthStore()

const menuItems = [
	{
		title: 'Dashboard',
		children: [
			{
				title: 'Inbox',
				icon: 'icon-mail',
				to: '/inbox'
			},
			{
				title: 'Settings',
				icon: 'icon-settings',
				to: '/settings'
			}
		]
	}
]

const handleLogout = async () => {
	await authStore.logout()
	router.push('/login')
}

const handleMenuClick = (item: any, closeSidebar: () => void) => {
	if (item.to) {
		router.push(item.to)
		closeSidebar()
	}
}
</script>

<template>
	<DashboardShell brandTitle="SoloDev Social" brand-logo="/logo.png" menuStyle="vertical" :hideMenu="false">
		<template #header>
			<div class="flex justify-end">
				<Button variant="destructive" @click="handleLogout">
					Logout
				</Button>
			</div>
		</template>

		<template #sidebar-menu="{ closeSidebar }">
			<SidebarMenu brand-logo="/logo.png" :items="menuItems"
				@itemClick="(item) => handleMenuClick(item, closeSidebar)" />
		</template>

		<template #content>
			<router-view />
		</template>
	</DashboardShell>
</template>
