import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { PilotUI } from './plugins/pilotui'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(PilotUI)

app.mount('#app')
