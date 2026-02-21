/**
 * Returns a short human-readable model name for display in the UI.
 *
 * Examples:
 *   "claude-sonnet-4-6"          → "Sonnet 4.6"
 *   "claude-haiku-4-5-20251001"  → "Haiku 4.5"
 *   "gpt-4o"                     → "GPT-4o"
 *   "gpt-4o-mini"                → "GPT-4o mini"
 *   "gemini-2.0-flash"           → "Gemini 2.0 flash"
 */
export function shortModelName(model: string | undefined): string {
  if (!model) return ''

  if (/claude/i.test(model)) {
    // Split after removing the "claude-" prefix and take name + first two version parts.
    // e.g. ['sonnet', '4', '6', …] → "Sonnet 4.6"
    const parts = model.replace(/^claude-/i, '').split('-')
    const name  = parts[0] ?? ''
    const major = parts[1]
    const minor = parts[2]
    const ver   = major && minor ? ` ${major}.${minor}` : major ? ` ${major}` : ''
    return name.charAt(0).toUpperCase() + name.slice(1) + ver
  }

  if (/gpt/i.test(model)) {
    // gpt-4o → GPT-4o,  gpt-4o-mini → GPT-4o mini
    return model.replace(/^gpt-/i, 'GPT-').replace(/-mini$/i, ' mini')
  }

  if (/gemini/i.test(model)) {
    // gemini-2.0-flash → Gemini 2.0 flash
    const m = model.replace(/^gemini-/i, '').replace(/-/g, ' ')
    return 'Gemini ' + m
  }

  return model
}
