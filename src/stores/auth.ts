import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAuth, signInWithPopup, GithubAuthProvider, signOut, onAuthStateChanged, type User } from 'firebase/auth'
import { app } from '../firebase/config'

export const useAuthStore = defineStore('auth', () => {
	const user = ref<User | null>(null)
	const loading = ref(true)
	const auth = getAuth(app)

	// Initialize auth state listener
	onAuthStateChanged(auth, (currentUser) => {
		user.value = currentUser
		loading.value = false
	})

	async function loginWithGithub() {
		try {
			const provider = new GithubAuthProvider()
			// Optional: Add scopes if we need to access github API directly from frontend
			// provider.addScope('repo')
			await signInWithPopup(auth, provider)
		} catch (error) {
			console.error("Login failed:", error)
			throw error
		}
	}

	async function logout() {
		try {
			await signOut(auth)
		} catch (error) {
			console.error("Logout failed:", error)
		}
	}

	return {
		user,
		loading,
		loginWithGithub,
		logout
	}
})
