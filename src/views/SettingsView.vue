<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { Modal } from 'pilotui/complex'
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
		const functions = getFunctions()
		const toggleHook = httpsCallable(functions, 'toggleRepoWebhook')

		if (newSet.has(repoName)) {
			// Disable tracking
			await toggleHook({ repoName, action: 'disable' })
			await deleteDoc(repoRef);
			newSet.delete(repoName);
		} else {
			// Enable tracking
			// WEBHOOK_URL is now handled by the backend environment variable
			const result = await toggleHook({ repoName, action: 'enable' }) as any
			await setDoc(repoRef, {
				repoName,
				addedAt: new Date(),
				githubHookId: result.data.hookId
			});
			newSet.add(repoName);
			await checkRepoHistories([repoName]);
		}
		trackedRepoIds.value = newSet;
	} catch (err: any) {
		console.error("Error toggling repo tracking:", err)
		toastError(`Failed to update tracking: ${err.message}`)
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
		const { ...restConfig } = config.value as any;
		await setDoc(docRef, restConfig, { merge: true })
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

const isXModalOpen = ref(false)
const testingX = ref(false)
const xKeys = ref({
	appKey: '',
	appSecret: '',
	accessToken: '',
	accessSecret: ''
})

const handleTestAndSaveX = async (toggleModal: (state: boolean) => void) => {
	if (!authStore.user?.uid) return;
	testingX.value = true;
	try {
		const functions = getFunctions()
		const testFn = httpsCallable<typeof xKeys.value, { success: boolean, username: string }>(functions, 'testXCredentials')
		const result = await testFn(xKeys.value)

		if (result.data.success) {
			const username = result.data.username;
			const userRef = doc(db, 'users', authStore.user.uid);
			await setDoc(userRef, {
				xAppKey: xKeys.value.appKey,
				xAppSecret: xKeys.value.appSecret,
				xAccessToken: xKeys.value.accessToken,
				xAccessSecret: xKeys.value.accessSecret,
				xUsername: username,
				xConnectedAt: new Date(),
			}, { merge: true });

			authStore.setXConnected(true, username);
			toastSuccess("X Account successfully connected!")
			toggleModal(false)
			xKeys.value = { appKey: '', appSecret: '', accessToken: '', accessSecret: '' }
		}
	} catch (error: any) {
		console.error("Test X keys failed:", error)
		toastError(`Failed to authenticate with X: ${error.message}`)
	} finally {
		testingX.value = false;
	}
}

const handleDisconnectX = async () => {
	if (!authStore.user?.uid) return;
	testingX.value = true;
	try {
		const userRef = doc(db, 'users', authStore.user.uid);
		// Import updateDoc and deleteField specifically for this
		const { updateDoc, deleteField } = await import('firebase/firestore')
		await updateDoc(userRef, {
			xAppKey: deleteField(),
			xAppSecret: deleteField(),
			xAccessToken: deleteField(),
			xAccessSecret: deleteField(),
			xUsername: deleteField(),
			xConnectedAt: deleteField(),
		});
		authStore.setXConnected(false, null);
		toastSuccess("X Account disconnected.")
	} catch (error: any) {
		console.error("X Disconnect failed:", error)
		toastError(`Failed to disconnect X account: ${error.message}`)
	} finally {
		testingX.value = false;
	}
}

const isLinkedInModalOpen = ref(false)
const testingLinkedIn = ref(false)
const linkedInToken = ref('')
const linkedInUrn = ref('')

const handleTestAndSaveLinkedIn = async (toggleModal: (state: boolean) => void) => {
	if (!authStore.user?.uid || !linkedInToken.value || !linkedInUrn.value) return;
	testingLinkedIn.value = true;
	try {
		const functions = getFunctions()
		// We pass the token and manually typed URN
		const testFn = httpsCallable<{ accessToken: string, urn: string }, { success: boolean, name: string }>(functions, 'testLinkedInCredentials')
		const result = await testFn({ accessToken: linkedInToken.value, urn: linkedInUrn.value })

		if (result.data.success) {
			const username = result.data.name;
			const userRef = doc(db, 'users', authStore.user.uid);

			// Format the URN if they just pasted the ID
			let formattedUrn = linkedInUrn.value;
			if (!formattedUrn.startsWith('urn:li:person:')) {
				formattedUrn = `urn:li:person:${formattedUrn}`;
			}

			await setDoc(userRef, {
				linkedInAccessToken: linkedInToken.value,
				linkedInUrn: formattedUrn,
				linkedInUsername: username,
				linkedInConnectedAt: new Date(),
			}, { merge: true });

			authStore.setLinkedInConnected(true, username);
			toastSuccess("LinkedIn Account successfully connected!")
			toggleModal(false)
			linkedInToken.value = ''
			linkedInUrn.value = ''
		}
	} catch (error: any) {
		console.error("Test LinkedIn token failed:", error)
		toastError(`Failed to authenticate with LinkedIn: ${error.message}`)
	} finally {
		testingLinkedIn.value = false;
	}
}

const handleDisconnectLinkedIn = async () => {
	if (!authStore.user?.uid) return;
	testingLinkedIn.value = true;
	try {
		const userRef = doc(db, 'users', authStore.user.uid);
		const { updateDoc, deleteField } = await import('firebase/firestore')
		await updateDoc(userRef, {
			linkedInAccessToken: deleteField(),
			linkedInUrn: deleteField(),
			linkedInUsername: deleteField(),
			linkedInConnectedAt: deleteField(),
		});
		authStore.setLinkedInConnected(false, null);
		toastSuccess("LinkedIn Account disconnected.")
	} catch (error: any) {
		console.error("LinkedIn Disconnect failed:", error)
		toastError(`Failed to disconnect LinkedIn account: ${error.message}`)
	} finally {
		testingLinkedIn.value = false;
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

				<div class="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
					<div class="flex items-center gap-3">
						<svg class="h-6 w-6 dark:text-white" fill="currentColor" viewBox="0 0 24 24">
							<path
								d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.451-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
						</svg>
						<div>
							<p class="font-medium dark:text-white">X (Twitter)</p>
							<p v-if="authStore.isXConnected" class="text-sm text-green-500 font-medium">
								✓ Connected{{ authStore.xUsername ? ` as ${authStore.xUsername}` : '' }}
							</p>
							<p v-else class="text-sm text-gray-500 dark:text-gray-400">Used to publish your tech updates
							</p>
						</div>
					</div>
					<div class="flex gap-2">
						<Button v-if="authStore.isXConnected" variant="outline" size="sm" :disabled="testingX"
							@click="handleDisconnectX">{{
								testingX ? 'Disconnecting...' : 'Disconnect' }}</Button>

						<Modal v-else v-model="isXModalOpen" title="Setup X (Twitter) Account" size="lg">
							<template #trigger="{ toggleModal }">
								<Button variant="outline" size="sm" @click="toggleModal(true)">Setup X Account</Button>
							</template>
							<template #default="{ toggleModal }">
								<div class="space-y-4 pt-2">
									<p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
										To publish to X, you need to provide your OAuth 1.0a keys. Create an app in the
										X Developer Portal with Read/Write permissions.
									</p>
									<Input v-model="xKeys.appKey" label="API Key (Consumer Key)"
										placeholder="Enter API Key" type="password" />
									<Input v-model="xKeys.appSecret" label="API Key Secret (Consumer Secret)"
										placeholder="Enter API Key Secret" type="password" />
									<Input v-model="xKeys.accessToken" label="Access Token"
										placeholder="Enter Access Token" type="password" />
									<Input v-model="xKeys.accessSecret" label="Access Token Secret"
										placeholder="Enter Access Token Secret" type="password" />

									<div
										class="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100 dark:border-gray-700">
										<Button variant="outline" @click="toggleModal(false)">Cancel</Button>
										<Button variant="primary"
											:disabled="testingX || !xKeys.appKey || !xKeys.appSecret || !xKeys.accessToken || !xKeys.accessSecret"
											@click="handleTestAndSaveX(toggleModal)">
											{{ testingX ? 'Testing Connection...' : 'Test & Save' }}
										</Button>
									</div>
								</div>
							</template>
						</Modal>
					</div>
				</div>

				<div class="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
					<div class="flex items-center gap-3">
						<svg class="h-6 w-6 dark:text-white" fill="currentColor" viewBox="0 0 24 24">
							<path
								d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
						</svg>
						<div>
							<p class="font-medium dark:text-white">LinkedIn</p>
							<p v-if="authStore.isLinkedInConnected" class="text-sm text-green-500 font-medium">
								✓ Connected{{ authStore.linkedInUsername ? ` as ${authStore.linkedInUsername}` : '' }}
							</p>
							<p v-else class="text-sm text-gray-500 dark:text-gray-400">Used to publish your tech updates
							</p>
						</div>
					</div>
					<div class="flex gap-2">
						<Button v-if="authStore.isLinkedInConnected" variant="outline" size="sm"
							:disabled="testingLinkedIn" @click="handleDisconnectLinkedIn">{{
								testingLinkedIn ? 'Disconnecting...' : 'Disconnect' }}</Button>

						<Modal v-else v-model="isLinkedInModalOpen" title="Setup LinkedIn Account" size="lg">
							<template #trigger="{ toggleModal }">
								<Button variant="outline" size="sm" @click="toggleModal(true)">Setup LinkedIn</Button>
							</template>
							<template #default="{ toggleModal }">
								<div class="space-y-4 pt-2">
									<p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
										To publish to LinkedIn, you need to provide an OAuth 2.0 Access Token. You can
										generate one from the LinkedIn Developer Portal under your App's Auth -> Token
										Generator. Make sure it has the `w_member_social` scope.
										<br /><br />
										Since this scope doesn't expose your profile ID automatically, you must also
										provide your LinkedIn Person URN (or just the ID string). You can find this by
										querying the `https://api.linkedin.com/v2/me` endpoint in their tester or by
										inspecting your API logs.
									</p>
									<Input v-model="linkedInToken" label="LinkedIn Access Token"
										placeholder="Enter Access Token" type="password" />
									<Input v-model="linkedInUrn" label="Person URN or ID"
										placeholder="e.g. urn:li:person:abc123xyz or abc123xyz" />

									<div
										class="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100 dark:border-gray-700">
										<Button variant="outline" @click="toggleModal(false)">Cancel</Button>
										<Button variant="primary"
											:disabled="testingLinkedIn || !linkedInToken || !linkedInUrn"
											@click="handleTestAndSaveLinkedIn(toggleModal)">
											{{ testingLinkedIn ? 'Testing Connection...' : 'Test & Save' }}
										</Button>
									</div>
								</div>
							</template>
						</Modal>
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
