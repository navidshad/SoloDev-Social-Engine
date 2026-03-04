<script setup lang="ts">
import { Button } from 'pilotui/elements'
import { useAuthStore } from '../stores/auth'
import { useRouter } from 'vue-router'
import { watch } from 'vue'

const authStore = useAuthStore()
const router = useRouter()

watch(() => authStore.user, (newVal) => {
	if (newVal) {
		router.push('/inbox')
	}
})

const handleLogin = async () => {
	try {
		await authStore.loginWithGoogle()
	} catch (error) {
		// Handle error gracefully if needed
	}
}
</script>

<template>
	<div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
		<div class="max-w-md w-full space-y-8 bg-white dark:bg-gray-800 p-8 rounded-xl shadow-lg">
			<div class="text-center">
				<h2 class="mt-6 text-3xl font-extrabold text-gray-900 dark:text-white">
					SoloDev Social Engine
				</h2>
				<p class="mt-2 text-sm text-gray-600 dark:text-gray-400">
					Sign in with Google to automate your social presence
				</p>
			</div>

			<div class="mt-8">
				<Button variant="primary" class="w-full flex justify-center py-3" @click="handleLogin"
					:disabled="authStore.loading">
					<span class="flex items-center gap-2">
						<svg class="h-5 w-5" viewBox="0 0 24 24">
							<path fill="currentColor"
								d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
							<path fill="currentColor"
								d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
							<path fill="currentColor"
								d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
							<path fill="currentColor"
								d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 12-4.53z" />
						</svg>
						Continue with Google
					</span>
				</Button>
			</div>
		</div>
	</div>
</template>
