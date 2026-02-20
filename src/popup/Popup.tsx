import { useEffect, useState } from 'react'
import type { LLMConfig, LLMProvider } from '../types'
import { verifyApiKey } from '../lib/llm/verify'

const PROVIDERS: { value: LLMProvider; label: string; models: string[]; url: string }[] = [
  {
    value: 'anthropic',
    label: 'Anthropic Claude',
    models: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'],
    url: 'https://console.anthropic.com',
  },
  {
    value: 'openai',
    label: 'OpenAI',
    models: ['gpt-4o', 'gpt-4o-mini'],
    url: 'https://platform.openai.com',
  },
  {
    value: 'gemini',
    label: 'Google Gemini',
    models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro'],
    url: 'https://aistudio.google.com/app/apikey',
  },
]

type Status = 'idle' | 'verifying' | 'connected' | 'invalid' | 'error'

async function loadConfig(): Promise<LLMConfig | null> {
  return new Promise(resolve => {
    chrome.storage.local.get('llmConfig', r => resolve((r.llmConfig as LLMConfig) ?? null))
  })
}

async function saveConfig(config: LLMConfig): Promise<void> {
  return new Promise(resolve => chrome.storage.local.set({ llmConfig: config }, resolve))
}

async function clearConfig(): Promise<void> {
  return new Promise(resolve => chrome.storage.local.remove('llmConfig', resolve))
}

export default function Popup() {
  const [provider, setProvider] = useState<LLMProvider>('anthropic')
  const [model, setModel]       = useState(PROVIDERS[0].models[0])
  const [apiKey, setApiKey]     = useState('')
  const [status, setStatus]     = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    loadConfig().then(cfg => {
      if (!cfg) return
      setProvider(cfg.provider)
      setModel(cfg.model)
      setApiKey(cfg.apiKey)
      setStatus('connected')
    })
  }, [])

  const providerInfo = PROVIDERS.find(p => p.value === provider)!

  function handleProviderChange(p: LLMProvider) {
    setProvider(p)
    setModel(PROVIDERS.find(x => x.value === p)!.models[0])
    // If the user switches provider, require re-verification
    if (status === 'connected') setStatus('idle')
  }

  async function handleSave() {
    const key = apiKey.trim()
    if (!key) {
      setStatus('invalid')
      setErrorMsg('API key is required.')
      return
    }

    setStatus('verifying')
    setErrorMsg('')

    const config: LLMConfig = { provider, model, apiKey: key }

    try {
      const valid = await verifyApiKey(config)
      if (!valid) {
        setStatus('invalid')
        setErrorMsg('Invalid key — check it and try again.')
        return
      }
      await saveConfig(config)
      setStatus('connected')
    } catch {
      setStatus('error')
      setErrorMsg('Network error — check your connection and try again.')
    }
  }

  async function handleDisconnect() {
    await clearConfig()
    setApiKey('')
    setStatus('idle')
    setErrorMsg('')
  }

  const busy = status === 'verifying'

  const buttonLabel =
    status === 'verifying'  ? 'Verifying…' :
    status === 'connected'  ? '✓ Connected' :
    'Verify & Save'

  return (
    <div style={styles.container}>

      {/* Header */}
      <div style={styles.header}>
        <span style={styles.logo}>FormBuddy Settings</span>
        {status === 'connected' && (
          <span style={styles.connectedBadge}>● Connected</span>
        )}
      </div>

      {/* Provider */}
      <label style={styles.label}>Provider</label>
      <select
        style={styles.select}
        value={provider}
        onChange={e => handleProviderChange(e.target.value as LLMProvider)}
        disabled={busy}
      >
        {PROVIDERS.map(p => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
      </select>

      <button
        style={styles.linkButton}
        onClick={() => chrome.tabs.create({ url: providerInfo.url })}
      >
        Get API key from {providerInfo.label} ↗
      </button>

      {/* Model */}
      <label style={styles.label}>Model</label>
      <select
        style={styles.select}
        value={model}
        onChange={e => { setModel(e.target.value); if (status === 'connected') setStatus('idle') }}
        disabled={busy}
      >
        {providerInfo.models.map(m => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>

      {/* API Key */}
      <label style={styles.label}>API Key</label>
      <input
        style={{
          ...styles.input,
          borderColor: status === 'invalid' ? '#d93025' : '#ccc',
        }}
        type="password"
        placeholder="Paste your API key here"
        value={apiKey}
        onChange={e => { setApiKey(e.target.value); if (status !== 'idle') setStatus('idle') }}
        disabled={busy}
      />

      {/* Actions */}
      <div style={styles.row}>
        <button
          style={{
            ...styles.button,
            opacity: busy ? 0.7 : 1,
            background: status === 'connected' ? '#059669' : '#1a73e8',
          }}
          onClick={handleSave}
          disabled={busy || status === 'connected'}
        >
          {buttonLabel}
        </button>

        {status === 'connected' && (
          <button style={styles.disconnectButton} onClick={handleDisconnect}>
            Disconnect
          </button>
        )}
      </div>

      {/* Feedback messages */}
      {status === 'invalid' && (
        <p style={styles.invalidMsg}>✗ {errorMsg}</p>
      )}
      {status === 'error' && (
        <p style={styles.errorMsg}>⚠ {errorMsg}</p>
      )}
      {status === 'verifying' && (
        <p style={styles.infoMsg}>Making a test call to verify your key…</p>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    width: '300px',
    padding: '16px',
    fontFamily: 'system-ui, sans-serif',
    fontSize: '13px',
    color: '#111',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '14px',
  },
  logo: { fontSize: '14px', fontWeight: 700 },
  connectedBadge: {
    background: '#d1fae5',
    color: '#065f46',
    fontSize: '11px',
    padding: '2px 8px',
    borderRadius: '999px',
    fontWeight: 600,
  },
  label: {
    display: 'block',
    fontWeight: 600,
    fontSize: '12px',
    marginBottom: '4px',
    marginTop: '12px',
    color: '#374151',
  },
  select: {
    width: '100%',
    padding: '6px 8px',
    borderRadius: '5px',
    border: '1px solid #ccc',
    fontSize: '13px',
    boxSizing: 'border-box' as const,
  },
  input: {
    width: '100%',
    padding: '6px 8px',
    borderRadius: '5px',
    border: '1px solid #ccc',
    fontSize: '13px',
    boxSizing: 'border-box' as const,
    outline: 'none',
  },
  linkButton: {
    background: 'none',
    border: 'none',
    color: '#1a73e8',
    cursor: 'pointer',
    fontSize: '11px',
    padding: '3px 0 0',
    display: 'block',
  },
  row: { display: 'flex', gap: '8px', marginTop: '14px' },
  button: {
    flex: 1,
    padding: '8px',
    color: '#fff',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '13px',
    transition: 'background 0.2s',
  },
  disconnectButton: {
    padding: '8px 12px',
    background: '#f3f4f6',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '5px',
    cursor: 'pointer',
    fontSize: '13px',
  },
  invalidMsg: { color: '#d93025', fontSize: '12px', marginTop: '8px', margin: '8px 0 0' },
  errorMsg:   { color: '#b45309', fontSize: '12px', marginTop: '8px', margin: '8px 0 0' },
  infoMsg:    { color: '#6b7280', fontSize: '11px', marginTop: '8px', margin: '8px 0 0' },
}
