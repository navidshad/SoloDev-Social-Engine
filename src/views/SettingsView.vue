<script setup lang="ts">
import { ref } from 'vue'
import { Card } from 'pilotui/elements'
import { Input, TextArea, CheckboxInput } from 'pilotui/form'
import { Button } from 'pilotui/elements'

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
</script>

<template>
	<div class="max-w-4xl mx-auto p-4 space-y-6">
		<div class="mb-5">
			<h2 class="text-2xl font-bold dark:text-white">Settings</h2>
			<p class="text-gray-500 dark:text-gray-400">Manage your external credentials and AI preferences</p>
		</div>

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
