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
	geminiApiKey: '',
	readmeImagePolicy: 'first' // 'never', 'first', 'always'
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
		await callFn({ 
			repoName,
			readmeImagePolicy: config.value.readmeImagePolicy
		})
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

const handleTestAndSaveLinkedIn = async (toggleModal: (state: boolean) => void) => {
	if (!authStore.user?.uid || !linkedInToken.value) return;
	testingLinkedIn.value = true;
	try {
		const functions = getFunctions()
		const testFn = httpsCallable<{ accessToken: string }, { success: boolean, name: string, urn: string }>(functions, 'testLinkedInCredentials')
		const result = await testFn({ accessToken: linkedInToken.value })

		if (result.data.success) {
			const username = result.data.name;
			const urn = result.data.urn;
			const userRef = doc(db, 'users', authStore.user.uid);

			await setDoc(userRef, {
				linkedInAccessToken: linkedInToken.value,
				linkedInUrn: urn,
				linkedInUsername: username,
				linkedInConnectedAt: new Date(),
			}, { merge: true });

			authStore.setLinkedInConnected(true, username);
			toastSuccess("LinkedIn Account successfully connected!")
			toggleModal(false)
			linkedInToken.value = ''
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

// --- LinkedIn Pages (organizations) ---
interface ConnectedPage { id: string; displayName: string; urn: string; type: string }
interface DiscoveredOrg { urn: string; organizationId: string; name: string }

const connectedPages = ref<ConnectedPage[]>([])
const discoveredOrgs = ref<DiscoveredOrg[]>([])
const loadingPages = ref(false)
const discoveringPages = ref(false)
const hasDiscovered = ref(false)

const loadConnectedPages = async () => {
	if (!authStore.user?.uid) return
	try {
		const snap = await getDocs(collection(db, `users/${authStore.user.uid}/socialAccounts`))
		const pages: ConnectedPage[] = []
		snap.forEach(d => {
			const data = d.data() as any
			pages.push({ id: d.id, displayName: data.displayName || data.urn, urn: data.urn, type: data.type || 'organization' })
		})
		connectedPages.value = pages
	} catch (err) {
		console.error('Failed to load connected pages:', err)
	}
}

const discoverPages = async () => {
	if (!authStore.user?.uid) return
	discoveringPages.value = true
	try {
		const functions = getFunctions()
		const fn = httpsCallable<Record<string, never>, { success: boolean, organizations: DiscoveredOrg[] }>(functions, 'listLinkedInOrganizations')
		const result = await fn({})
		discoveredOrgs.value = result.data.organizations || []
		hasDiscovered.value = true
	} catch (err: any) {
		console.error('Discover pages failed:', err)
		toastError(err.message || 'Failed to list LinkedIn Pages.')
	} finally {
		discoveringPages.value = false
	}
}

const connectPage = async (org: DiscoveredOrg) => {
	if (!authStore.user?.uid) return
	loadingPages.value = true
	try {
		const functions = getFunctions()
		const fn = httpsCallable(functions, 'connectSocialAccount')
		await fn({ type: 'organization', urn: org.urn, displayName: org.name, organizationId: org.organizationId })
		toastSuccess(`Connected page "${org.name}".`)
		await loadConnectedPages()
	} catch (err: any) {
		toastError(err.message || 'Failed to connect page.')
	} finally {
		loadingPages.value = false
	}
}

const disconnectPage = async (page: ConnectedPage) => {
	if (!authStore.user?.uid) return
	loadingPages.value = true
	try {
		const functions = getFunctions()
		const fn = httpsCallable(functions, 'connectSocialAccount')
		await fn({ disconnectId: page.id })
		toastSuccess(`Disconnected "${page.displayName}".`)
		await loadConnectedPages()
	} catch (err: any) {
		toastError(err.message || 'Failed to disconnect page.')
	} finally {
		loadingPages.value = false
	}
}

const isPageConnected = (urn: string) => connectedPages.value.some(p => p.urn === urn)

watch(() => authStore.user?.uid, (uid) => { if (uid) loadConnectedPages() }, { immediate: true })
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
										Generator. Make sure it has the `w_member_social`, `openid`, and `profile`
										scopes.
										<br /><br />
										<i>Note: If you don't see `openid` and `profile` available, make sure you have
											added
											the "Sign In with LinkedIn" product to your app!</i>
									</p>
									<Input v-model="linkedInToken" label="LinkedIn Access Token"
										placeholder="Enter Access Token" type="password" />

									<div
										class="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-100 dark:border-gray-700">
										<Button variant="outline" @click="toggleModal(false)">Cancel</Button>
										<Button variant="primary" :disabled="testingLinkedIn || !linkedInToken"
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

		<!-- LinkedIn Pages -->
		<Card v-if="authStore.isLinkedInConnected">
			<div class="p-6 space-y-4">
				<div class="flex items-center justify-between gap-4">
					<div class="space-y-1">
						<h3 class="text-lg font-semibold dark:text-white">LinkedIn Pages</h3>
						<p class="text-sm text-gray-500 dark:text-gray-400">
							Connect company Pages you administer, so posts can be published as the Page instead of
							your personal profile.
						</p>
					</div>
					<Button variant="outline" size="sm" :disabled="discoveringPages" @click="discoverPages">
						{{ discoveringPages ? 'Searching...' : 'Find Pages I manage' }}
					</Button>
				</div>

				<!-- Connected pages -->
				<div v-if="connectedPages.length" class="space-y-2">
					<span class="text-xs font-bold text-gray-400 uppercase tracking-widest">Connected</span>
					<div v-for="page in connectedPages" :key="page.id"
						class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
						<div class="flex flex-col min-w-0">
							<span class="text-sm font-medium dark:text-white truncate">{{ page.displayName }}</span>
							<span class="text-[10px] text-gray-500 truncate">{{ page.urn }}</span>
						</div>
						<Button variant="outline" size="sm" :disabled="loadingPages" @click="disconnectPage(page)">
							Disconnect</Button>
					</div>
				</div>

				<!-- Discovered orgs -->
				<div v-if="hasDiscovered" class="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-700">
					<span class="text-xs font-bold text-gray-400 uppercase tracking-widest">Pages you manage</span>
					<div v-if="discoveredOrgs.length === 0" class="text-sm text-gray-500 dark:text-gray-400 italic">
						No Pages found. Your LinkedIn token needs the Community Management API scopes
						(<code>r_organization_admin</code>, <code>w_organization_social</code>).
					</div>
					<div v-for="org in discoveredOrgs" :key="org.urn"
						class="flex items-center justify-between p-3 bg-white dark:bg-gray-800/40 border border-gray-100 dark:border-gray-700/50 rounded-xl">
						<div class="flex flex-col min-w-0">
							<span class="text-sm font-medium dark:text-gray-200 truncate">{{ org.name }}</span>
							<span class="text-[10px] text-gray-500 truncate">{{ org.urn }}</span>
						</div>
						<Button v-if="isPageConnected(org.urn)" variant="ghost" size="sm" disabled>✓ Connected</Button>
						<Button v-else variant="outline" size="sm" :disabled="loadingPages" @click="connectPage(org)">
							Connect</Button>
					</div>
				</div>

				<p class="text-[11px] text-gray-400 dark:text-gray-500 italic">
					Posting to a Page requires your LinkedIn access token to include the
					<code>w_organization_social</code> and <code>r_organization_admin</code> scopes (these need the
					Community Management API product enabled on your LinkedIn app).
				</p>
			</div>
		</Card>

		<!-- Repository Tracking & Automation -->
		<Card v-if="authStore.isGithubConnected">
			<div class="p-6 space-y-6">
				<!-- Header Section -->
				<div class="flex flex-col md:flex-row md:items-start justify-between gap-4">
					<div class="space-y-1">
						<h3 class="text-lg font-semibold dark:text-white flex items-center gap-2">
							GitHub Automation
							<span
								class="text-[10px] bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded font-normal text-gray-500 uppercase tracking-wider">Sync
								Active</span>
						</h3>
						<p class="text-sm text-gray-500 dark:text-gray-400 max-w-xl">
							Connect your repositories to automatically generate and publish social media updates for
							every new
							release.
							<a href="https://gist.github.com/navidshad/9b78557cf957f804db56d2dadd1faced" target="_blank"
								class="inline-flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-600 font-medium transition-colors">
								<span>🚀 How to automate releases</span>
								<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor"
									stroke-width="2.5">
									<path
										d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6m6-3l5 5m0-5l-5 5m5-5H12" />
								</svg>
							</a>
						</p>
					</div>


				</div>

				<!-- Repository Selection Grid -->
				<div class="space-y-3">
					<div class="flex items-center justify-between px-1">
						<span class="text-xs font-bold text-gray-400 uppercase tracking-widest">Select
							Repositories</span>
						<span v-if="isLoadingRepos" class="text-[10px] text-blue-500 animate-pulse">Checking
							GitHub...</span>
					</div>

					<div v-if="githubRepos.length === 0 && !isLoadingRepos"
						class="p-8 text-center border-2 border-dashed border-gray-100 dark:border-gray-800 rounded-2xl">
						<p class="text-sm text-gray-500">No repositories found. Ensure your token has enough
							permissions.</p>
					</div>

					<div v-else
						class="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-2 custom-scrollbar">
						<div v-for="repo in githubRepos" :key="repo.id"
							class="group flex items-center justify-between p-3 bg-white dark:bg-gray-800/40 border border-gray-100 dark:border-gray-700/50 rounded-xl hover:border-blue-200 dark:hover:border-blue-900/50 hover:shadow-xs transition-all duration-200">
							<div class="flex items-center gap-3 min-w-0">
								<CheckboxInput :modelValue="trackedRepoIds.has(repo.full_name)"
									@update:modelValue="toggleRepoTracking(repo.full_name)" />
								<div class="flex flex-col min-w-0">
									<span class="text-sm font-medium truncate dark:text-gray-200">{{ repo.name }}</span>
									<span v-if="repo.private"
										class="text-[9px] text-orange-500 font-bold uppercase tracking-tighter">Private</span>
								</div>
							</div>

							<div class="flex items-center shrink-0">
								<Button
									v-if="trackedRepoIds.has(repo.full_name) && repoHistoryMap[repo.full_name] === false"
									variant="ghost" size="sm"
									class="h-7! px-2! text-[10px] text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20"
									:disabled="isGeneratingMap[repo.full_name]"
									@click="generateInitialPost(repo.full_name)">
									{{ isGeneratingMap[repo.full_name] ? '...' : '+ Generate Draft' }}
								</Button>
								<span v-else-if="trackedRepoIds.has(repo.full_name)"
									class="text-[10px] text-green-500 font-medium px-2 italic">Active</span>
							</div>
						</div>
					</div>
				</div>

				<!-- README Image Policy -->
				<div class="space-y-4 pt-6 border-t border-gray-100 dark:border-gray-700">
					<div class="space-y-1">
						<h4 class="text-sm font-bold dark:text-white">README Image Strategy</h4>
						<p class="text-xs text-gray-500 dark:text-gray-400">
							Choose how we handle images found in your repository's README.
						</p>
					</div>

					<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
						<button @click="config.readmeImagePolicy = 'never'" :class="[
							'relative flex flex-col p-4 text-left border rounded-2xl transition-all duration-300 group',
							config.readmeImagePolicy === 'never'
								? 'border-blue-500 bg-blue-50/30 dark:bg-blue-900/10'
								: 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'
						]">
							<div v-if="config.readmeImagePolicy === 'never'" class="absolute top-3 right-3">
								<div class="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
							</div>
							<span class="text-xs font-bold mb-1"
								:class="config.readmeImagePolicy === 'never' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'">Strict</span>
							<span class="text-[10px] text-gray-500 leading-normal">Ignore README. Only use images from
								specific
								release notes.</span>
						</button>

						<button @click="config.readmeImagePolicy = 'first'" :class="[
							'relative flex flex-col p-4 text-left border rounded-2xl transition-all duration-300 group',
							config.readmeImagePolicy === 'first'
								? 'border-blue-500 bg-blue-50/30 dark:bg-blue-900/10'
								: 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'
						]">
							<div v-if="config.readmeImagePolicy === 'first'" class="absolute top-3 right-3">
								<div class="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
							</div>
							<span class="text-xs font-bold mb-1"
								:class="config.readmeImagePolicy === 'first' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'">Smart
								(First)</span>
							<span class="text-[10px] text-gray-500 leading-normal italic">Recommended. Check README only
								for the
								project's introduction.</span>
						</button>

						<button @click="config.readmeImagePolicy = 'always'" :class="[
							'relative flex flex-col p-4 text-left border rounded-2xl transition-all duration-300 group',
							config.readmeImagePolicy === 'always'
								? 'border-blue-500 bg-blue-50/30 dark:bg-blue-900/10'
								: 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'
						]">
							<div v-if="config.readmeImagePolicy === 'always'" class="absolute top-3 right-3">
								<div class="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
							</div>
							<span class="text-xs font-bold mb-1"
								:class="config.readmeImagePolicy === 'always' ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'">Always</span>
							<span class="text-[10px] text-gray-500 leading-normal">Always scan README for fresh images
								or
								updated logos.</span>
						</button>
					</div>
				</div>

				<div class="space-y-4 pt-6 border-t border-gray-100 dark:border-gray-700">
					<div class="space-y-1">
						<h4 class="text-sm font-bold dark:text-white">Auto-Post Delivery</h4>
						<p class="text-xs text-gray-500 dark:text-gray-400">
							Choose if AI-generated posts should be published immediately or kept as drafts.
						</p>
					</div>

					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<button @click="config.autoPostEnabled = false" :class="[
							'relative flex flex-col p-4 text-left border rounded-2xl transition-all duration-300 group',
							config.autoPostEnabled === false
								? 'border-blue-500 bg-blue-50/30 dark:bg-blue-900/10'
								: 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'
						]">
							<div v-if="config.autoPostEnabled === false" class="absolute top-3 right-3">
								<div class="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
							</div>
							<span class="text-xs font-bold mb-1"
								:class="config.autoPostEnabled === false ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'">Manual Review</span>
							<span class="text-[10px] text-gray-500 leading-normal">Save as drafts first. You decide when
								they
								go live.</span>
						</button>

						<button @click="config.autoPostEnabled = true" :class="[
							'relative flex flex-col p-4 text-left border rounded-2xl transition-all duration-300 group',
							config.autoPostEnabled === true
								? 'border-blue-500 bg-blue-50/30 dark:bg-blue-900/10'
								: 'border-gray-100 dark:border-gray-800 hover:border-gray-200 dark:hover:border-gray-700'
						]">
							<div v-if="config.autoPostEnabled === true" class="absolute top-3 right-3">
								<div class="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
							</div>
							<span class="text-xs font-bold mb-1"
								:class="config.autoPostEnabled === true ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'">Auto-Post</span>
							<span class="text-[10px] text-gray-500 leading-normal">Automatically publish to social
								platforms
								as soon as ready.</span>
						</button>
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

		<div class="flex justify-end gap-3 mt-4">
			<Button variant="outline">Cancel</Button>
			<Button variant="primary" :disabled="isSaving || !isLoaded" @click="saveSettings">
				{{ isSaving ? 'Saving...' : 'Save Changes' }}
			</Button>
		</div>
	</div>
</template>
