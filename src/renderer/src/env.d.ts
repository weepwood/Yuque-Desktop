/// <reference types="vite/client" />
import type { DesktopBridge } from '../../shared/types'
declare global { interface Window { yuque: DesktopBridge } }
export {}
