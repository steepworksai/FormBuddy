/**
 * Central place for LLM prompts.
 * You can safely edit these prompt strings to tune behavior.
 */

export const FIELD_ORGANIZER_PROMPT = `You normalize messy personal document text into clean, form-ready key-value pairs.

Return ONLY valid JSON with this exact structure:
{
  "fields": [
    {
      "label": "string",
      "value": "string",
      "sourceText": "string"
    }
  ]
}

Primary objective:
- Produce concise values that can be copied directly into form fields.

Rules:
- Include only explicit high-confidence facts present in the input text.
- Never guess, infer, or synthesize values that are not clearly present.
- Never output paragraphs as "value".
- Keep each "value" as short as practical.
- Keep "sourceText" to a short supporting line or phrase from the input.
- De-duplicate label/value pairs.
- Prefer canonical labels when possible:
  - Full Name
  - Email Address
  - Phone Number
  - Date of Birth
  - Passport Number
  - Loyalty Number
  - Address
  - Country
- If no clean fields are found, return:
  {"fields":[]}

Formatting constraints:
- Output plain JSON only.
- No markdown.
- No comments.
- No trailing text.`

export const SEARCH_INDEX_PROMPT = `You build a compact search index for form autofill from OCR/PDF text and extracted fields.

Return ONLY valid JSON with this exact shape:
{
  "autofill": {
    "snake_case_key": "value"
  },
  "items": [
    {
      "fieldLabel": "string",
      "value": "string",
      "aliases": ["string"],
      "sourceText": "string",
      "confidence": "high | medium | low"
    }
  ]
}

Rules:
- Keep each value concise and directly copyable into form fields.
- Build "autofill" with canonical keys when possible:
  full_name, first_name, last_name, date_of_birth, email_address, phone_number,
  driver_license_number, issue_date, expiration_date, address, city, state, zip_code,
  passport_number, country.
- Put only high-confidence values in "autofill".
- Include multiple aliases/synonyms for how the same field may appear on forms.
- Never invent values not present in source text/fields.
- Remove duplicates (same fieldLabel + value).
- Prefer canonical labels when possible:
  Full Name, First Name, Last Name, Date of Birth, Email Address, Phone Number,
  Driver License Number, Issue Date, Expiration Date, Address, City, State, ZIP Code,
  Passport Number, Country.
- If no useful items are found, return {"items":[]}.

Formatting constraints:
- Output plain JSON only.
- No markdown.
- No comments.
- No trailing text.`

/**
 * Configurable prompt parts for manual "Fields From Doc" fetch + form mapping.
 * Edit these arrays/values instead of editing one long prompt paragraph.
 */
export const FORM_AUTOFILL_MAP_CONFIG = {
  objective:
    'Map requested form fields to best values from selected personal document indexes.',
  canonicalKeys: [
    'full_name',
    'first_name',
    'last_name',
    'date_of_birth',
    'email_address',
    'phone_number',
    'driver_license_number',
    'license_class',
    'issue_date',
    'expiration_date',
    'height',
    'weight',
    'eye_color',
    'address',
    'city',
    'state',
    'zip_code',
    'passport_number',
    'country',
  ],
  rules: [
    'Use only provided requested fields and document data.',
    'Prefer exact and semantic matches from autofill keys, aliases, and indexed items.',
    'For driver-license style requests, prioritize Issue Date, Expiration Date, Height, Weight, and Eye Color when present.',
    'Requested field lists may include default/sample/prefilled text from forms; treat those as hints, not true values.',
    'Never copy placeholder/demo/default values unless the same value is explicitly present in selected document data.',
    'Do not invent values.',
    'If unsure, omit that field from mappings.',
    'Keep values concise and form-ready.',
    'Normalize common date formats when clearly inferable from the source value.',
    'De-duplicate by fieldId.',
  ],
  constraints: [
    'Output plain JSON only.',
    'No markdown.',
    'No comments.',
    'No trailing text.',
  ],
} as const

export function getFormAutofillMapPrompt(): string {
  return `You are a precise form-value matcher.

Objective:
- ${FORM_AUTOFILL_MAP_CONFIG.objective}

Preferred canonical keys:
- ${FORM_AUTOFILL_MAP_CONFIG.canonicalKeys.join(', ')}

Return ONLY valid JSON with this exact shape:
{
  "mappings": [
    {
      "fieldId": "string",
      "fieldLabel": "string",
      "value": "string",
      "sourceFile": "string",
      "reason": "string",
      "confidence": "high | medium | low"
    }
  ]
}

Rules:
${FORM_AUTOFILL_MAP_CONFIG.rules.map(rule => `- ${rule}`).join('\n')}

Formatting constraints:
${FORM_AUTOFILL_MAP_CONFIG.constraints.map(rule => `- ${rule}`).join('\n')}`
}
