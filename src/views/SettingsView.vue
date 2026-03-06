<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { Card } from 'pilotui/elements'
import { Input, TextArea, CheckboxInput } from 'pilotui/form'
import { Button } from 'pilotui/elements'
import { useAuthStore } from '../stores/auth'
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, deleteDoc, query, where, limit } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { toastSuccess, toastError } from 'pilotui/toast'

const authStore = useAuthStore()
const db = getFirestore()

const config = ref({
	xApiKey: '',
	linkedInToken: '',
	personaVoice: 'I write in a "build in public" style. I am humble but authoritative. I rarely use hashtags on X. I like to focus on the "why" behind the code. Use a conversational tone.',
	autoPostEnabled: false,
	geminiApiKey: ''
})

const isSaving = ref(false)
const isLoaded = ref(false)

// Repository Management
interface GithubRepo {
	id: number;
	name: string;
	full_name: string;
	private: boolean;
}
const githubRepos = ref<GithubRepo[]>([])
const trackedRepoIds = ref<Set<string>>(new Set())
const isLoadingRepos = ref(false)

const fetchRepositories = async () => {
	if (!authStore.user?.uid || !authStore.isGithubConnected) return;
	isLoadingRepos.value = true;
	try {
		const userDoc = await getDoc(doc(db, 'users', authStore.user.uid))
		const token = userDoc.data()?.githubAccessToken

		if (!token) return;

		const response = await fetch('https://api.github.com/user/repos?sort=updated&per_page=30', {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/vnd.github.v3+json'
			}
		});
		if (!response.ok) throw new Error("Failed to fetch repositories")

		githubRepos.value = await response.json();

		// Fetch Tracked Repos from Firestore
		const trackedSnap = await getDocs(collection(db, `users/${authStore.user.uid}/trackedRepos`))
		const tracked = new Set<string>()
		trackedSnap.forEach(doc => tracked.add(doc.data().repoName))
		trackedRepoIds.value = tracked

		// Check history for all tracked repos
		await checkRepoHistories(Array.from(tracked))
	} catch (err: unknown) {
		console.error("Error fetching repositories:", err)
	} finally {
		isLoadingRepos.value = false;
	}
}

const repoHistoryMap = ref<Record<string, boolean>>({})
const isGeneratingMap = ref<Record<string, boolean>>({})

const checkRepoHistories = async (repoNames: string[]) => {
	if (!authStore.user?.uid) return;
	const promises = repoNames.map(async (repoName) => {
		const q = query(
			collection(db, `users/${authStore.user?.uid}/drafts`),
			where('repoName', '==', repoName),
			where('status', 'in', ['Draft', 'Published', 'Partially Published']),
			limit(1)
		)
		const snap = await getDocs(q)
		repoHistoryMap.value[repoName] = !snap.empty
	})
	await Promise.all(promises)
}

const generateInitialPost = async (repoName: string) => {
	if (!authStore.user?.uid) return;
	isGeneratingMap.value[repoName] = true
	try {
		const functions = getFunctions()
		const callFn = httpsCallable(functions, 'generateInitialPost')
		await callFn({ repoName })
		toastSuccess("Initial draft generated! Check your Inbox.")
		repoHistoryMap.value[repoName] = true
	} catch (err: any) {
		console.error("Error generating initial post:", err)
		toastError(`Failed to generate: ${err.message}`)
	} finally {
		isGeneratingMap.value[repoName] = false
	}
}

const toggleRepoTracking = async (repoName: string) => {
	if (!authStore.user?.uid) return;

	// In vue templates, sets are tricky, so we create a new Set to trigger reactivity
	const newSet = new Set(trackedRepoIds.value)

	const sanitizedRepoName = repoName.replace(/\//g, '_');
	const repoRef = doc(db, `users/${authStore.user.uid}/trackedRepos`, sanitizedRepoName);

	try {
		if (newSet.has(repoName)) {
			await deleteDoc(repoRef);
			newSet.delete(repoName);
		} else {
			await setDoc(repoRef, {
				repoName,
				addedAt: new Date()
			});
			newSet.add(repoName);
			await checkRepoHistories([repoName]);
		}
		trackedRepoIds.value = newSet;
	} catch (err) {
		console.error("Error toggling repo tracking:", err)
		toastError("Failed to update tracking status")
	}
}

watch([() => authStore.user?.uid, () => authStore.isGithubConnected], ([uid, isConnected]) => {
	if (uid && isConnected) {
		fetchRepositories()
	} else {
		githubRepos.value = []
		trackedRepoIds.value.clear()
	}
}, { immediate: true })

onMounted(async () => {
	if (authStore.user?.uid) {
		const docRef = doc(db, `users/${authStore.user.uid}/settings`, 'config')
		const docSnap = await getDoc(docRef)
		if (docSnap.exists()) {
			config.value = { ...config.value, ...docSnap.data() } as typeof config.value
		}
		isLoaded.value = true
	}
})

// Optional: watch user changes if component stays mounted while auth changes
watch(() => authStore.user?.uid, async (newUid) => {
	if (newUid) {
		const docRef = doc(db, `users/${newUid}/settings`, 'config')
		const docSnap = await getDoc(docRef)
		if (docSnap.exists()) {
			config.value = { ...config.value, ...docSnap.data() } as typeof config.value
		}
		isLoaded.value = true
	} else {
		isLoaded.value = false
	}
})

const saveSettings = async () => {
	if (!authStore.user?.uid) return
	isSaving.value = true
	try {
		const docRef = doc(db, `users/${authStore.user.uid}/settings`, 'config')
		await setDoc(docRef, config.value, { merge: true })
		toastSuccess("Settings saved successfully!")
	} catch (error: any) {
		console.error("Failed to save settings:", error)
		toastError(`Failed to save settings: ${error.message}`)
	} finally {
		isSaving.value = false
	}
}

const handleConnectGithub = async () => {
	try {
		await authStore.connectGithub()
	} catch (error: unknown) {
		console.error(error)
		const msg = error instanceof Error ? error.message : "Failed to connect GitHub account."
		toastError(msg)
	}
}

const handleDisconnectGithub = async () => {
	try {
		await authStore.disconnectGithub()
	} catch (error: unknown) {
		console.error(error)
		const msg = error instanceof Error ? error.message : "Failed to disconnect GitHub account."
		toastError(msg)
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
							<p v-if="authStore.isGithubConnected" class="text-sm text-green-500 font-medium">
								✓ Connected{{ authStore.githubUsername ? ` as ${authStore.githubUsername}` : '' }}
							</p>
							<p v-else class="text-sm text-gray-500 dark:text-gray-400">Used to fetch repository releases
							</p>
						</div>
					</div>
					<div class="flex gap-2">
						<Button v-if="authStore.isGithubConnected" variant="outline" size="sm"
							:disabled="authStore.githubLoading" @click="handleDisconnectGithub">{{
								authStore.githubLoading ? 'Disconnecting...' : 'Disconnect' }}</Button>
						<Button v-else variant="outline" size="sm" :disabled="authStore.githubLoading"
							@click="handleConnectGithub">{{ authStore.githubLoading ? 'Connecting...' : 'Connect'
							}}</Button>
					</div>
				</div>
			</div>
		</Card>

		<!-- Repository Tracking -->
		<Card v-if="authStore.isGithubConnected">
			<div class="p-6 space-y-4">
				<div class="flex items-center justify-between">
					<div>
						<h3 class="text-lg font-semibold dark:text-white">Tracked Repositories</h3>
						<p class="text-sm text-gray-500 dark:text-gray-400">Select which repositories you want to track
							for automated social media posts. <span
								class="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-xs ml-1">Changes save
								automatically</span></p>
					</div>
				</div>

				<div v-if="isLoadingRepos" class="text-sm text-gray-500">Loading repositories...</div>
				<div v-else-if="githubRepos.length === 0" class="text-sm text-gray-500">No repositories found or token
					lacks permissions.</div>
				<div v-else
					class="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto pr-2 rounded-lg border border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30 p-2">
					<div v-for="repo in githubRepos" :key="repo.id"
						class="flex items-center gap-3 p-2 hover:bg-white dark:hover:bg-gray-700 rounded transition-colors w-full overflow-hidden">
						<div class="flex items-center gap-3 flex-1 min-w-0">
							<CheckboxInput :modelValue="trackedRepoIds.has(repo.full_name)"
								@update:modelValue="toggleRepoTracking(repo.full_name)" :text="repo.name"
								class="truncate" />
						</div>
						<div class="flex items-center gap-2 shrink-0 ml-auto">
							<span v-if="repo.private"
								class="text-xs bg-gray-200 dark:bg-gray-600 px-1.5 py-0.5 rounded text-gray-600 dark:text-gray-300">Private</span>
							<Button
								v-if="trackedRepoIds.has(repo.full_name) && repoHistoryMap[repo.full_name] === false"
								size="sm" variant="secondary" class="py-1! px-2! text-xs h-auto"
								:disabled="isGeneratingMap[repo.full_name]"
								@click="generateInitialPost(repo.full_name)">
								{{ isGeneratingMap[repo.full_name] ? 'Generating...' : '✨ Generate Initial Post' }}
							</Button>
						</div>
					</div>
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
					<Input v-model="config.geminiApiKey" label="Gemini API Key" placeholder="AI..." type="password" />
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
			<Button variant="primary" :disabled="isSaving || !isLoaded" @click="saveSettings">
				{{ isSaving ? 'Saving...' : 'Save Changes' }}
			</Button>
		</div>
	</div>
</template>
