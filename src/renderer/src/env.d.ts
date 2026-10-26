/// <reference types="vite/client" />
import type { YuqueSessionBridge } from '../../shared/session-contract'
declare global { interface Window { yuque: YuqueSessionBridge } }
export {}
