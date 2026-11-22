export interface OpenFilePayload {
  path: string
  content: string
}

export interface SaveResult {
  ok: boolean
  path?: string
  error?: string
  canceled?: boolean
}

export interface DesktopBridge {
  isDesktop: true
  ready(): Promise<OpenFilePayload | null>
  onOpenFile(cb: (payload: OpenFilePayload) => void): () => void
  onMenu(cb: (action: string) => void): () => void
  onWindowState(cb: (state: { maximized: boolean }) => void): () => void
  onFileChanged(cb: (payload: OpenFilePayload) => void): () => void
  setDirty(dirty: boolean, path: string | null): void
  confirmClose(): void
  openDialog(): Promise<void>
  saveFile(path: string, content: string, expected: string): Promise<SaveResult>
  saveFileAs(content: string, suggestedName?: string): Promise<SaveResult>
  setDefaultYaml(): Promise<{ ok: boolean; error?: string }>
  windowControl(action: 'minimize' | 'maximize' | 'close'): void
}

declare global {
  interface Window {
    desktop?: DesktopBridge
  }
}
