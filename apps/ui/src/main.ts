import './assets/main.css'

import { createApp } from 'vue'

import JsonViewer from 'vue3-json-viewer'
import 'vue3-json-viewer/dist/vue3-json-viewer.css'

import App from './app/App.vue'
import router from './router'

const app = createApp(App)

app.use(router)
app.use(JsonViewer)

app.mount('#root')
