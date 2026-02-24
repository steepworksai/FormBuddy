#!/usr/bin/env node
/**
 * FormBuddy — Passenger Demo Generator
 *
 * Generates:
 *   demo/passenger-1-john-smith.pdf
 *   demo/passenger-2-sarah-lee.pdf
 *   demo/passenger-3-raj-patel.pdf
 *   demo/flight-booking-form.html   ← form with all 3 passengers
 *
 * Usage:
 *   node scripts/generate-demo-passengers.mjs
 */

import { chromium } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PDF_DIR  = resolve(__dirname, '../output/pdf')
const HTML_DIR = resolve(__dirname, '../output/html')
mkdirSync(PDF_DIR,  { recursive: true })
mkdirSync(HTML_DIR, { recursive: true })

// ─── Passenger Data ───────────────────────────────────────────────────────────

const PASSENGERS = [
  {
    id: 1,
    firstName: 'John',
    middleName: 'Andrew',
    lastName: 'Smith',
    dob: '15 March 1985',
    gender: 'Male',
    nationality: 'United States of America',
    passport: 'P12345678',
    issued: '10 June 2019',
    expiry: '09 June 2029',
    issuedBy: 'U.S. Department of State',
    phone: '+1 (312) 555-0147',
    email: 'john.smith@email.com',
    address: '742 Evergreen Terrace, Springfield, IL 62701',
    file: 'john-smith',
    color: '#1a3a6e',
  },
  {
    id: 2,
    firstName: 'Sarah',
    middleName: 'Mei',
    lastName: 'Lee',
    dob: '22 July 1990',
    gender: 'Female',
    nationality: 'United States of America',
    passport: 'P98765432',
    issued: '05 February 2021',
    expiry: '04 February 2031',
    issuedBy: 'U.S. Department of State',
    phone: '+1 (415) 555-0293',
    email: 'sarah.lee@email.com',
    address: '88 Ocean Avenue, San Francisco, CA 94112',
    file: 'sarah-lee',
    color: '#6b21a8',
  },
  {
    id: 3,
    firstName: 'Raj',
    middleName: 'Kumar',
    lastName: 'Patel',
    dob: '03 November 1978',
    gender: 'Male',
    nationality: 'United States of America',
    passport: 'P55512349',
    issued: '18 August 2020',
    expiry: '17 August 2030',
    issuedBy: 'U.S. Department of State',
    phone: '+1 (212) 555-0384',
    email: 'raj.patel@email.com',
    address: '245 Park Avenue, New York, NY 10167',
    file: 'raj-patel',
    color: '#0f5132',
  },
]

// ─── Passport Card HTML ───────────────────────────────────────────────────────

function passengerHtml(p) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Passenger ${p.id} — ${p.firstName} ${p.lastName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Arial', sans-serif; background: #f0f2f5; padding: 40px; }
    .card { max-width: 680px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.12); }
    .header { background: ${p.color}; color: #fff; padding: 24px 28px; display: flex; justify-content: space-between; align-items: center; }
    .header-left h2 { font-size: 11px; font-weight: normal; letter-spacing: 2px; text-transform: uppercase; opacity: 0.8; }
    .header-left h1 { font-size: 22px; font-weight: 900; margin-top: 4px; }
    .header-right { text-align: right; }
    .badge { background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.4); border-radius: 6px; padding: 6px 14px; font-size: 12px; font-weight: bold; letter-spacing: 1px; }
    .passenger-num { font-size: 36px; font-weight: 900; opacity: 0.15; position: absolute; right: 28px; top: 12px; }
    .body { padding: 28px; position: relative; }
    .avatar { width: 80px; height: 80px; border-radius: 50%; background: ${p.color}22; border: 3px solid ${p.color}44; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: bold; color: ${p.color}; margin-bottom: 16px; }
    .full-name { font-size: 20px; font-weight: 900; color: #111; margin-bottom: 4px; }
    .nationality { font-size: 12px; color: #888; margin-bottom: 20px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 20px; }
    .field { }
    .field-label { font-size: 9px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.8px; color: #999; margin-bottom: 3px; }
    .field-value { font-size: 13px; font-weight: bold; color: #1a1a1a; }
    .section-title { font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: ${p.color}; border-bottom: 2px solid ${p.color}33; padding-bottom: 4px; margin-bottom: 12px; }
    .passport-box { background: ${p.color}08; border: 1px solid ${p.color}33; border-radius: 8px; padding: 16px 20px; margin-bottom: 20px; }
    .passport-num { font-size: 24px; font-weight: 900; color: ${p.color}; letter-spacing: 3px; margin-bottom: 8px; font-family: 'Courier New', monospace; }
    .contact-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .mrz { background: #f5f5f5; border-top: 3px solid ${p.color}; padding: 12px 16px; font-family: 'Courier New', monospace; font-size: 10px; color: #555; letter-spacing: 2px; line-height: 1.8; }
    .mrz-label { font-size: 8px; text-transform: uppercase; letter-spacing: 1px; color: #aaa; margin-bottom: 4px; font-family: Arial; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header" style="position:relative;">
      <div class="header-left">
        <h2>Travel Document — Passenger ${p.id} of 3</h2>
        <h1>${p.firstName} ${p.lastName}</h1>
      </div>
      <div class="header-right">
        <div class="badge">PASSPORT</div>
        <div style="margin-top:8px; font-size:11px; opacity:0.8;">United States of America</div>
      </div>
      <div class="passenger-num">${p.id}</div>
    </div>

    <div class="body">
      <div class="avatar">${p.firstName[0]}${p.lastName[0]}</div>
      <div class="full-name">${p.firstName} ${p.middleName} ${p.lastName}</div>
      <div class="nationality">${p.nationality}</div>

      <div class="section-title">Personal Information</div>
      <div class="grid">
        <div class="field">
          <div class="field-label">First Name</div>
          <div class="field-value">${p.firstName}</div>
        </div>
        <div class="field">
          <div class="field-label">Last Name</div>
          <div class="field-value">${p.lastName}</div>
        </div>
        <div class="field">
          <div class="field-label">Middle Name</div>
          <div class="field-value">${p.middleName}</div>
        </div>
        <div class="field">
          <div class="field-label">Date of Birth</div>
          <div class="field-value">${p.dob}</div>
        </div>
        <div class="field">
          <div class="field-label">Gender</div>
          <div class="field-value">${p.gender}</div>
        </div>
        <div class="field">
          <div class="field-label">Nationality</div>
          <div class="field-value">American</div>
        </div>
      </div>

      <div class="section-title">Passport Details</div>
      <div class="passport-box">
        <div class="field-label">Passport Number</div>
        <div class="passport-num">${p.passport}</div>
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-top:8px;">
          <div class="field">
            <div class="field-label">Date of Issue</div>
            <div class="field-value">${p.issued}</div>
          </div>
          <div class="field">
            <div class="field-label">Date of Expiry</div>
            <div class="field-value">${p.expiry}</div>
          </div>
          <div class="field">
            <div class="field-label">Issued By</div>
            <div class="field-value">${p.issuedBy}</div>
          </div>
        </div>
      </div>

      <div class="section-title">Contact Information</div>
      <div class="contact-grid">
        <div class="field">
          <div class="field-label">Phone Number</div>
          <div class="field-value">${p.phone}</div>
        </div>
        <div class="field">
          <div class="field-label">Email Address</div>
          <div class="field-value">${p.email}</div>
        </div>
        <div class="field" style="grid-column: span 2;">
          <div class="field-label">Home Address</div>
          <div class="field-value">${p.address}</div>
        </div>
      </div>
    </div>

    <div class="mrz">
      <div class="mrz-label">Machine Readable Zone (MRZ)</div>
      P&lt;USA${p.lastName.toUpperCase()}&lt;&lt;${p.firstName.toUpperCase()}&lt;${p.middleName.toUpperCase()}&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;
      ${p.passport}&lt;USA${p.dob.replace(/\D/g,'').slice(-2)}${String(p.dob.split(' ')[2]).slice(-2)}${['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(p.dob.split(' ')[1].toLowerCase().slice(0,3))+1 < 10 ? '0' + ((['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(p.dob.split(' ')[1].toLowerCase().slice(0,3))+1)) : ((['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(p.dob.split(' ')[1].toLowerCase().slice(0,3))+1))}${p.dob.split(' ')[0].padStart(2,'0')}M${p.expiry.split(' ')[2].slice(-2)}${['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(p.expiry.split(' ')[1].toLowerCase().slice(0,3))+1 < 10 ? '0' + ((['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(p.expiry.split(' ')[1].toLowerCase().slice(0,3))+1)) : ((['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(p.expiry.split(' ')[1].toLowerCase().slice(0,3))+1))}${p.expiry.split(' ')[0].padStart(2,'0')}&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;0
    </div>
  </div>
</body>
</html>`
}

// ─── Flight Booking Form HTML ─────────────────────────────────────────────────

const bookingFormHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Flight Booking — Passenger Details</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #111; background: #f0f4f8; }
    .page { max-width: 920px; margin: 32px auto; padding-bottom: 40px; }
    .top-bar { background: #1a3a6e; color: #fff; padding: 16px 28px; border-radius: 10px 10px 0 0; display: flex; justify-content: space-between; align-items: center; }
    .top-bar h1 { font-size: 18px; }
    .top-bar .flight { font-size: 12px; opacity: 0.8; margin-top: 2px; }
    .top-bar .step { background: rgba(255,255,255,0.2); padding: 6px 14px; border-radius: 20px; font-size: 12px; }
    .card { background: #fff; border: 1px solid #dde3ec; margin-bottom: 0; padding: 28px; }
    .card:last-of-type { border-radius: 0 0 10px 10px; }
    .passenger-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid #e8edf7; }
    .pax-badge { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 16px; color: #fff; flex-shrink: 0; }
    .pax-1 { background: #1a3a6e; }
    .pax-2 { background: #6b21a8; }
    .pax-3 { background: #0f5132; }
    .passenger-header h2 { font-size: 15px; font-weight: bold; color: #1a3a6e; }
    .passenger-header p { font-size: 11px; color: #888; }
    label { display: block; font-size: 11px; color: #555; margin-bottom: 3px; font-weight: bold; }
    input[type=text], input[type=email], input[type=tel] {
      width: 100%; border: 1px solid #c5cdd8; border-radius: 6px; padding: 9px 12px;
      font-size: 13px; background: #fafbff; transition: border-color 0.2s;
    }
    input:focus { outline: none; border-color: #4f46e5; box-shadow: 0 0 0 3px rgba(79,70,229,0.1); }
    .row { display: grid; gap: 14px; margin-bottom: 14px; }
    .col-2 { grid-template-columns: 1fr 1fr; }
    .col-3 { grid-template-columns: 1fr 1fr 1fr; }
    .col-4 { grid-template-columns: 1fr 1fr 1fr 1fr; }
    .section-label { font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: #4f46e5; margin-bottom: 10px; margin-top: 16px; }
    .divider { border: none; border-top: 1px solid #eef0f5; margin: 20px 0; }
    .submit-bar { background: #fff; border: 1px solid #dde3ec; border-top: none; border-radius: 0 0 10px 10px; padding: 20px 28px; display: flex; justify-content: flex-end; gap: 12px; }
    .btn-secondary { padding: 10px 24px; border: 1px solid #c5cdd8; background: #fff; border-radius: 8px; font-size: 13px; cursor: pointer; }
    .btn-primary { padding: 10px 32px; background: linear-gradient(135deg, #1a3a6e, #4f46e5); color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: bold; cursor: pointer; }
    .required::after { content: ' *'; color: #e53e3e; }
    .field { display: flex; flex-direction: column; }
  </style>
</head>
<body>
<div class="page">

  <div class="top-bar">
    <div>
      <h1>Passenger Details</h1>
      <div class="flight">Flight AX 204 · New York (JFK) → London (LHR) · 14 Jun 2025</div>
    </div>
    <div class="step">Step 2 of 4 — Traveller Info</div>
  </div>

  <!-- PASSENGER 1 -->
  <div class="card">
    <div class="passenger-header">
      <div class="pax-badge pax-1">1</div>
      <div>
        <h2>Passenger 1 — Lead Traveller</h2>
        <p>Information must match passport exactly</p>
      </div>
    </div>

    <div class="section-label">Personal Details</div>
    <div class="row col-3">
      <div class="field"><label class="required">First Name</label><input type="text" id="p1_first_name" name="p1_first_name" aria-label="Passenger 1 First Name" placeholder="As on passport" /></div>
      <div class="field"><label>Middle Name</label><input type="text" id="p1_middle_name" name="p1_middle_name" aria-label="Passenger 1 Middle Name" placeholder="If applicable" /></div>
      <div class="field"><label class="required">Last Name</label><input type="text" id="p1_last_name" name="p1_last_name" aria-label="Passenger 1 Last Name" placeholder="As on passport" /></div>
    </div>
    <div class="row col-3">
      <div class="field"><label class="required">Date of Birth</label><input type="text" id="p1_dob" name="p1_dob" aria-label="Passenger 1 Date of Birth" placeholder="DD/MM/YYYY" /></div>
      <div class="field"><label class="required">Gender</label><input type="text" id="p1_gender" name="p1_gender" aria-label="Passenger 1 Gender" placeholder="Male / Female" /></div>
      <div class="field"><label>Nationality</label><input type="text" id="p1_nationality" name="p1_nationality" aria-label="Passenger 1 Nationality" placeholder="e.g. American" /></div>
    </div>

    <div class="section-label">Passport Details</div>
    <div class="row col-3">
      <div class="field"><label class="required">Passport Number</label><input type="text" id="p1_passport_no" name="p1_passport_no" aria-label="Passenger 1 Passport Number" placeholder="e.g. P12345678" /></div>
      <div class="field"><label class="required">Date of Expiry</label><input type="text" id="p1_passport_expiry" name="p1_passport_expiry" aria-label="Passenger 1 Passport Expiry" placeholder="DD/MM/YYYY" /></div>
      <div class="field"><label>Date of Issue</label><input type="text" id="p1_passport_issued" name="p1_passport_issued" aria-label="Passenger 1 Passport Issue Date" placeholder="DD/MM/YYYY" /></div>
    </div>

    <div class="section-label">Contact Details</div>
    <div class="row col-3">
      <div class="field"><label class="required">Phone Number</label><input type="tel" id="p1_phone" name="p1_phone" aria-label="Passenger 1 Phone" placeholder="+1 (XXX) XXX-XXXX" /></div>
      <div class="field"><label class="required">Email Address</label><input type="email" id="p1_email" name="p1_email" aria-label="Passenger 1 Email" placeholder="email@example.com" /></div>
      <div class="field"><label>Home Address</label><input type="text" id="p1_address" name="p1_address" aria-label="Passenger 1 Address" placeholder="Street, City, State ZIP" /></div>
    </div>
  </div>

  <!-- PASSENGER 2 -->
  <div class="card" style="border-top: none;">
    <hr class="divider" style="margin-top:0;" />
    <div class="passenger-header">
      <div class="pax-badge pax-2">2</div>
      <div>
        <h2>Passenger 2</h2>
        <p>Information must match passport exactly</p>
      </div>
    </div>

    <div class="section-label">Personal Details</div>
    <div class="row col-3">
      <div class="field"><label class="required">First Name</label><input type="text" id="p2_first_name" name="p2_first_name" aria-label="Passenger 2 First Name" placeholder="As on passport" /></div>
      <div class="field"><label>Middle Name</label><input type="text" id="p2_middle_name" name="p2_middle_name" aria-label="Passenger 2 Middle Name" placeholder="If applicable" /></div>
      <div class="field"><label class="required">Last Name</label><input type="text" id="p2_last_name" name="p2_last_name" aria-label="Passenger 2 Last Name" placeholder="As on passport" /></div>
    </div>
    <div class="row col-3">
      <div class="field"><label class="required">Date of Birth</label><input type="text" id="p2_dob" name="p2_dob" aria-label="Passenger 2 Date of Birth" placeholder="DD/MM/YYYY" /></div>
      <div class="field"><label class="required">Gender</label><input type="text" id="p2_gender" name="p2_gender" aria-label="Passenger 2 Gender" placeholder="Male / Female" /></div>
      <div class="field"><label>Nationality</label><input type="text" id="p2_nationality" name="p2_nationality" aria-label="Passenger 2 Nationality" placeholder="e.g. American" /></div>
    </div>

    <div class="section-label">Passport Details</div>
    <div class="row col-3">
      <div class="field"><label class="required">Passport Number</label><input type="text" id="p2_passport_no" name="p2_passport_no" aria-label="Passenger 2 Passport Number" placeholder="e.g. P98765432" /></div>
      <div class="field"><label class="required">Date of Expiry</label><input type="text" id="p2_passport_expiry" name="p2_passport_expiry" aria-label="Passenger 2 Passport Expiry" placeholder="DD/MM/YYYY" /></div>
      <div class="field"><label>Date of Issue</label><input type="text" id="p2_passport_issued" name="p2_passport_issued" aria-label="Passenger 2 Passport Issue Date" placeholder="DD/MM/YYYY" /></div>
    </div>

    <div class="section-label">Contact Details</div>
    <div class="row col-3">
      <div class="field"><label class="required">Phone Number</label><input type="tel" id="p2_phone" name="p2_phone" aria-label="Passenger 2 Phone" placeholder="+1 (XXX) XXX-XXXX" /></div>
      <div class="field"><label class="required">Email Address</label><input type="email" id="p2_email" name="p2_email" aria-label="Passenger 2 Email" placeholder="email@example.com" /></div>
      <div class="field"><label>Home Address</label><input type="text" id="p2_address" name="p2_address" aria-label="Passenger 2 Address" placeholder="Street, City, State ZIP" /></div>
    </div>
  </div>

  <!-- PASSENGER 3 -->
  <div class="card" style="border-top: none;">
    <hr class="divider" style="margin-top:0;" />
    <div class="passenger-header">
      <div class="pax-badge pax-3">3</div>
      <div>
        <h2>Passenger 3</h2>
        <p>Information must match passport exactly</p>
      </div>
    </div>

    <div class="section-label">Personal Details</div>
    <div class="row col-3">
      <div class="field"><label class="required">First Name</label><input type="text" id="p3_first_name" name="p3_first_name" aria-label="Passenger 3 First Name" placeholder="As on passport" /></div>
      <div class="field"><label>Middle Name</label><input type="text" id="p3_middle_name" name="p3_middle_name" aria-label="Passenger 3 Middle Name" placeholder="If applicable" /></div>
      <div class="field"><label class="required">Last Name</label><input type="text" id="p3_last_name" name="p3_last_name" aria-label="Passenger 3 Last Name" placeholder="As on passport" /></div>
    </div>
    <div class="row col-3">
      <div class="field"><label class="required">Date of Birth</label><input type="text" id="p3_dob" name="p3_dob" aria-label="Passenger 3 Date of Birth" placeholder="DD/MM/YYYY" /></div>
      <div class="field"><label class="required">Gender</label><input type="text" id="p3_gender" name="p3_gender" aria-label="Passenger 3 Gender" placeholder="Male / Female" /></div>
      <div class="field"><label>Nationality</label><input type="text" id="p3_nationality" name="p3_nationality" aria-label="Passenger 3 Nationality" placeholder="e.g. American" /></div>
    </div>

    <div class="section-label">Passport Details</div>
    <div class="row col-3">
      <div class="field"><label class="required">Passport Number</label><input type="text" id="p3_passport_no" name="p3_passport_no" aria-label="Passenger 3 Passport Number" placeholder="e.g. P55512349" /></div>
      <div class="field"><label class="required">Date of Expiry</label><input type="text" id="p3_passport_expiry" name="p3_passport_expiry" aria-label="Passenger 3 Passport Expiry" placeholder="DD/MM/YYYY" /></div>
      <div class="field"><label>Date of Issue</label><input type="text" id="p3_passport_issued" name="p3_passport_issued" aria-label="Passenger 3 Passport Issue Date" placeholder="DD/MM/YYYY" /></div>
    </div>

    <div class="section-label">Contact Details</div>
    <div class="row col-3">
      <div class="field"><label class="required">Phone Number</label><input type="tel" id="p3_phone" name="p3_phone" aria-label="Passenger 3 Phone" placeholder="+1 (XXX) XXX-XXXX" /></div>
      <div class="field"><label class="required">Email Address</label><input type="email" id="p3_email" name="p3_email" aria-label="Passenger 3 Email" placeholder="email@example.com" /></div>
      <div class="field"><label>Home Address</label><input type="text" id="p3_address" name="p3_address" aria-label="Passenger 3 Address" placeholder="Street, City, State ZIP" /></div>
    </div>
  </div>

  <div class="submit-bar">
    <button class="btn-secondary" type="button">Back</button>
    <button class="btn-primary" type="button">Continue to Seat Selection →</button>
  </div>

</div>
</body>
</html>`

// ─── Generate files ───────────────────────────────────────────────────────────

const browser = await chromium.launch()

for (const p of PASSENGERS) {
  console.log(`⏳ Generating PDF for Passenger ${p.id} — ${p.firstName} ${p.lastName}…`)
  const page = await browser.newPage()
  await page.setContent(passengerHtml(p), { waitUntil: 'domcontentloaded' })
  const pdfPath = resolve(PDF_DIR, `${p.file}.pdf`)
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' },
  })
  await page.close()
  console.log(`  ✓ ${pdfPath}`)
}

await browser.close()

const formPath = resolve(HTML_DIR, 'flight-booking-form.html')
writeFileSync(formPath, bookingFormHtml, 'utf8')
console.log(`✓ Written: ${formPath}`)

console.log(`
────────────────────────────────────────────────────
  Passenger demo ready in demo/

  Source docs (index all 3 in FormBuddy):
    output/pdf/john-smith.pdf   → John Andrew Smith  | P12345678 | +1 (312) 555-0147
    output/pdf/sarah-lee.pdf    → Sarah Mei Lee       | P98765432 | +1 (415) 555-0293
    output/pdf/raj-patel.pdf    → Raj Kumar Patel     | P55512349 | +1 (212) 555-0384

  Form to fill:
    output/html/flight-booking-form.html    → open in Chrome, use FormBuddy to fill all 3

  Fields to paste in FormBuddy:
    Passenger 1 First Name, Passenger 1 Last Name, Passenger 1 Date of Birth,
    Passenger 1 Passport Number, Passenger 1 Phone, Passenger 1 Email,
    Passenger 2 First Name, Passenger 2 Last Name, Passenger 2 Date of Birth,
    Passenger 2 Passport Number, Passenger 2 Phone, Passenger 2 Email,
    Passenger 3 First Name, Passenger 3 Last Name, Passenger 3 Date of Birth,
    Passenger 3 Passport Number, Passenger 3 Phone, Passenger 3 Email
────────────────────────────────────────────────────
`)
