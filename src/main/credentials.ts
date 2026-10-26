import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { safeStorage } from 'electron'

export class CredentialVault {
  private file: string
  constructor(dataDir: string) { this.file = join(dataDir, 'credentials.enc') }
  save(token: string): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统安全存储不可用：拒绝以明文保存 Token')
    }
    const encrypted = safeStorage.encryptString(token)
    writeFileSync(this.file, encrypted, { mode: 0o600 })
  }
  get(): string | null {
    if (!existsSync(this.file)) return null
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统凭据服务不可用，请解锁钥匙串后重试')
    return safeStorage.decryptString(readFileSync(this.file))
  }
  clear(): void { if (existsSync(this.file)) unlinkSync(this.file) }
}
