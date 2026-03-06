import { createRouter, createWebHistory } from 'vue-router'
import { getAuth } from 'firebase/auth'
import { app } from '../firebase/config'

import AppLayout from '../layouts/AppLayout.vue'
import LoginView from '../views/LoginView.vue'
import InboxView from '../views/InboxView.vue'
import SettingsView from '../views/SettingsView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: LoginView,
      meta: { requiresGuest: true }
    },
    {
      path: '/',
      component: AppLayout,
      meta: { requiresAuth: true },
      children: [
        {
          path: '',
          redirect: '/inbox'
        },
        {
          path: 'inbox',
          name: 'Inbox',
          component: InboxView
        },
        {
          path: 'inbox/:id',
          name: 'Draft Detail',
          component: () => import('../views/DraftDetailView.vue')
        },
        {
          path: 'settings',
          name: 'Settings',
          component: SettingsView
        }
      ]
    }
  ],
})

router.beforeEach(async (to, from, next) => {
  const auth = getAuth(app)

  // Wait for auth initialization if first load
  await auth.authStateReady()
  const user = auth.currentUser

  const requiresAuth = to.matched.some(record => record.meta.requiresAuth)
  const requiresGuest = to.matched.some(record => record.meta.requiresGuest)

  if (requiresAuth && !user) {
    next({ name: 'Login' })
  } else if (requiresGuest && user) {
    next({ name: 'Inbox' })
  } else {
    next()
  }
})

export default router
