import type { DocumentIndex, FieldEntry, SearchIndexFile, SearchIndexItem } from '../../types'

function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function keyify(value: string): string {
  return normalize(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function splitName(fullName: string): { first?: string; middle?: string; last?: string } {
  const parts = normalize(fullName).split(' ').filter(Boolean)
  if (parts.length < 2) return {}
  if (parts.length === 2) return { first: parts[0], last: parts[1] }
  return {
    first: parts[0],
    middle: parts.slice(1, -1).join(' '),
    last: parts[parts.length - 1],
  }
}

function canonicalKeyForLabel(label: string): string | null {
  const l = normalize(label).toLowerCase()
  if (/^full\s*name$|name\b/.test(l) && !/first|last|middle/.test(l)) return 'full_name'
  if (/first\s*name|given\s*name/.test(l)) return 'first_name'
  if (/middle\s*name/.test(l)) return 'middle_name'
  if (/last\s*name|surname|family\s*name/.test(l)) return 'last_name'
  if (/date\s*of\s*birth|\bdob\b|birth\s*date/.test(l)) return 'date_of_birth'
  if (/email/.test(l)) return 'email_address'
  if (/phone|mobile|contact\s*number/.test(l)) return 'phone_number'
  if (/driver|license\s*number|\bdl\b/.test(l) && /number|no\b|id/.test(l)) return 'driver_license_number'
  if (/issue\s*date|\biss\b/.test(l)) return 'issue_date'
  if (/expir|expiry|\bexp\b/.test(l)) return 'expiration_date'
  if (/license\s*class|\bclass\b/.test(l)) return 'license_class'
  if (/\bsex\b|gender/.test(l)) return 'sex'
  if (/height|\bhgt\b/.test(l)) return 'height'
  if (/weight|\bwgt\b/.test(l)) return 'weight'
  if (/eye\s*color|\beyes\b/.test(l)) return 'eye_color'
  if (/hair\s*color|\bhair\b/.test(l)) return 'hair_color'
  if (/address\s*line\s*1|street\s*address|address(?!\s*line\s*2)/.test(l)) return 'address'
  if (/address\s*line\s*2|apt|unit|suite/.test(l)) return 'address_line_2'
  if (/city/.test(l)) return 'city'
  if (/state|province/.test(l)) return 'state'
  if (/zip|postal/.test(l)) return 'zip_code'
  if (/country/.test(l)) return 'country'
  if (/passport/.test(l)) return 'passport_number'
  if (/loyalty/.test(l)) return 'loyalty_number'
  return null
}

function addAutofillValue(
  autofill: Record<string, string>,
  key: string,
  value: string
): void {
  const normalized = normalize(value)
  if (!key || !normalized) return
  if (normalized.length > 240) return
  if (!autofill[key]) autofill[key] = normalized
}

function fieldToItem(field: FieldEntry): SearchIndexItem {
  const key = canonicalKeyForLabel(field.label)
  const aliases = [field.label, key ? key.replace(/_/g, ' ') : '']
    .map(normalize)
    .filter(Boolean)
  return {
    fieldLabel: normalize(field.label),
    value: normalize(field.value),
    aliases: [...new Set(aliases)],
    sourceText: normalize(field.boundingContext || field.value),
    confidence: field.confidence,
  }
}

export function buildLocalSearchIndex(entry: Pick<DocumentIndex, 'pages' | 'entities'>): SearchIndexFile {
  const autofill: Record<string, string> = {}
  const items: SearchIndexItem[] = []
  const seenItems = new Set<string>()

  for (const page of entry.pages) {
    for (const field of page.fields) {
      const item = fieldToItem(field)
      const itemKey = `${item.fieldLabel.toLowerCase()}|${item.value.toLowerCase()}`
      if (!seenItems.has(itemKey)) {
        seenItems.add(itemKey)
        items.push(item)
      }

      const canonical = canonicalKeyForLabel(field.label)
      if (canonical) addAutofillValue(autofill, canonical, field.value)
      addAutofillValue(autofill, keyify(field.label), field.value)
    }
  }

  const names = entry.entities.names ?? []
  const firstName = entry.entities.first_names?.[0]
  const lastName = entry.entities.last_names?.[0]
  const addresses = entry.entities.addresses ?? []
  const dates = entry.entities.dates ?? []
  const identifiers = entry.entities.identifiers ?? []
  const emails = entry.entities.emails ?? []
  const phones = entry.entities.phone_numbers ?? []

  if (names[0]) addAutofillValue(autofill, 'full_name', names[0])
  if (firstName) addAutofillValue(autofill, 'first_name', firstName)
  if (lastName) addAutofillValue(autofill, 'last_name', lastName)
  if (!autofill.first_name && !autofill.last_name && (names[0] || autofill.full_name)) {
    const split = splitName(names[0] || autofill.full_name)
    if (split.first) addAutofillValue(autofill, 'first_name', split.first)
    if (split.middle) addAutofillValue(autofill, 'middle_name', split.middle)
    if (split.last) addAutofillValue(autofill, 'last_name', split.last)
  }
  if (emails[0]) addAutofillValue(autofill, 'email_address', emails[0])
  if (phones[0]) addAutofillValue(autofill, 'phone_number', phones[0])
  if (addresses[0]) addAutofillValue(autofill, 'address', addresses[0])
  if (dates[0] && !autofill.date_of_birth) addAutofillValue(autofill, 'date_of_birth', dates[0])
  if (identifiers[0] && !autofill.driver_license_number && !autofill.passport_number) {
    addAutofillValue(autofill, 'identifier', identifiers[0])
  }

  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    items,
    autofill,
  }
}

export function mergeSearchIndexes(
  base: SearchIndexFile,
  override?: SearchIndexFile
): SearchIndexFile {
  if (!override) return base
  const autofill: Record<string, string> = { ...(base.autofill ?? {}) }
  for (const [key, value] of Object.entries(override.autofill ?? {})) {
    if (!autofill[key]) autofill[key] = value
    else autofill[key] = value
  }

  const seen = new Set<string>()
  const items: SearchIndexItem[] = []
  for (const item of [...(override.items ?? []), ...(base.items ?? [])]) {
    const fieldLabel = normalize(item.fieldLabel)
    const value = normalize(item.value)
    if (!fieldLabel || !value) continue
    const key = `${fieldLabel.toLowerCase()}|${value.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push({
      fieldLabel,
      value,
      aliases: Array.from(new Set((item.aliases ?? []).map(normalize).filter(Boolean))),
      sourceText: normalize(item.sourceText || value),
      confidence: item.confidence ?? 'medium',
    })
  }

  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    items,
    autofill,
  }
}
