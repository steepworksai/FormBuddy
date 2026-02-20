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

export function getManualFieldExtractionPrompt(): string {
  return `You are a document field extraction assistant.

Given a parsed document JSON and a list of form fields, extract the correct value
for each field and return ONLY as key-value pairs.

## INPUT FORMAT
- REFERENCE JSON is provided as "reference_json".
- FORM FIELDS are provided as "form_fields".

## RULES
- Extract values from the JSON in this order: entities -> fields -> rawText.
- Split names correctly: 2 parts = First + Last, 3 parts = First + Middle + Last.
- Dates must be YYYY-MM-DD format.
- Strip prefixes from identifiers when clearly present (example: "DL Y123" -> "Y123").
- Parse addresses into individual components when requested (Line 1, City, State, ZIP).
- Disambiguate dates by context (past = issued/DOB, future = expiry).
- If a value is not found, return "Not Found".
- Never output placeholder values like "Select", "YYYY-MM-DD", or "123 Main St".
- Do not include explanations, markdown, tables, bullets, JSON, or extra lines.

## OUTPUT
Return ONLY key-value pairs, nothing else.
Field Name: Extracted Value`
}
