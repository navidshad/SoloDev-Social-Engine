<script setup lang="ts">
import { ref } from 'vue'
import { Card } from 'pilotui/elements'
import { Input, TextArea, CheckboxInput } from 'pilotui/form'
import { Button } from 'pilotui/elements'
import { useAuthStore } from '../stores/auth'

const authStore = useAuthStore()

const config = ref({
	xApiKey: '',
	linkedInToken: '',
	githubWebhookSecret: '',
	personaVoice: 'I write in a "build in public" style. I am humble but authoritative. I rarely use hashtags on X. I like to focus on the "why" behind the code. Use a conversational tone.',
	autoPostEnabled: false
})

const saveSettings = async () => {
	// TODO: Save to firestore
	console.log("Saving settings...", config.value)
}

const handleConnectGithub = async () => {
	try {
		await authStore.connectGithub()
		alert("GitHub account connected successfully!")
	} catch (error) {
		alert("Failed to connect GitHub account.")
	}
}
</script>

<template>
	<div class="max-w-4xl mx-auto p-4 space-y-6">
		<div class="mb-5">
			<h2 class="text-2xl font-bold dark:text-white">Settings</h2>
			<p class="text-gray-500 dark:text-gray-400">Manage your external credentials and AI preferences</p>
		</div>

		<!-- Connected Accounts -->
		<Card>
			<div class="p-6 space-y-4">
				<h3 class="text-lg font-semibold dark:text-white">Connected Accounts</h3>
				<div class="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
					<div class="flex items-center gap-3">
						<svg class="h-6 w-6 dark:text-white" fill="currentColor" viewBox="0 0 24 24">
							<path fill-rule="evenodd"
								d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
								clip-rule="evenodd" />
						</svg>
						<div>
							<p class="font-medium dark:text-white">GitHub</p>
							<p class="text-sm text-gray-500 dark:text-gray-400">Used to fetch repository releases</p>
						</div>
					</div>
					<Button variant="outline" size="sm" @click="handleConnectGithub">Connect</Button>
				</div>
			</div>
		</Card>

		<!-- API Keys -->
		<Card>
			<div class="p-6 space-y-4">
				<h3 class="text-lg font-semibold dark:text-white">API & Integration Settings</h3>
				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					<Input v-model="config.xApiKey" label="X (Twitter) API Key" placeholder="sk-..." type="password" />
					<Input v-model="config.linkedInToken" label="LinkedIn OAuth Token" placeholder="AQV..."
						type="password" />
					<Input v-model="config.githubWebhookSecret" label="GitHub Webhook Secret"
						placeholder="Your secret string" type="password" />
				</div>
			</div>
		</Card>

		<!-- Persona Config -->
		<Card>
			<div class="p-6 space-y-4">
				<h3 class="text-lg font-semibold dark:text-white">Persona & Voice Configuration</h3>
				<p class="text-sm text-gray-500 dark:text-gray-400">This configuration is injected into the AI prompt
					for every generation.</p>
				<TextArea v-model="config.personaVoice" rows="5" label="Your Voice"
					placeholder="Describe how you talk online..." />
			</div>
		</Card>

		<!-- Automation Config -->
		<Card>
			<div class="p-6 space-y-4 flex flex-col sm:flex-row items-start sm:items-center justify-between">
				<div>
					<h3 class="text-lg font-semibold dark:text-white">Automation Rules</h3>
					<p class="text-sm text-gray-500 dark:text-gray-400">Choose whether AI-generated posts should go live
						immediately.</p>
				</div>
				<div class="mt-4 sm:mt-0 flex gap-2">
					<CheckboxInput v-model="config.autoPostEnabled" label="Enable Auto-Post" />
				</div>
			</div>
		</Card>

		<div class="flex justify-end gap-3 mt-4">
			<Button variant="outline">Cancel</Button>
			<Button variant="primary" @click="saveSettings">Save Changes</Button>
		</div>
	</div>
</template>
