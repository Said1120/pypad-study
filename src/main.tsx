import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import './styles.css'

const updateSW = registerSW({
  onNeedRefresh() {
    if (window.confirm('PyPad 有新版本。现在更新吗？你的项目不会被删除。')) void updateSW(true)
  },
  onOfflineReady() {
    window.dispatchEvent(new CustomEvent('pypad-offline-ready'))
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
)

