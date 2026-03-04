<script setup lang="ts">
import { DashboardShell, SidebarMenu } from 'pilotui/shell'
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
</script>

<template>
	<DashboardShell brandTitle="SoloDev Social" menuStyle="vertical" :hideMenu="false">
		<template #sidebar-menu="{ closeSidebar }">
			<SidebarMenu :items="menuItems" @itemClick="closeSidebar" />
			<div class="mt-4 px-4">
				<button
					class="w-full flex items-center justify-center gap-2 p-2 bg-red-50 text-red-600 rounded-md hover:bg-red-100 transition"
					@click="async () => { await handleLogout(); closeSidebar() }">
					Logout
				</button>
			</div>
		</template>
		<template #content>
			<router-view />
		</template>
	</DashboardShell>
</template>
