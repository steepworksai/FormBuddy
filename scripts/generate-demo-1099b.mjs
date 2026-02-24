#!/usr/bin/env node
/**
 * FormBuddy — Demo Document Generator
 *
 * Generates:
 *   1. demo/1099b-apex-brokerage.pdf  — sample 1099-B source document
 *   2. demo/form-8949.html            — tax form for FormBuddy to fill
 *
 * Usage:
 *   node scripts/generate-demo-1099b.mjs
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

// ─── Sample Data ──────────────────────────────────────────────────────────────

const TAXPAYER = {
  name: 'John A. Smith',
  ssn: '123-45-6789',
  address: '742 Evergreen Terrace',
  city: 'Springfield, IL 62701',
}

const BROKER = {
  name: 'Apex Brokerage Inc.',
  address: '1 Financial Plaza, Suite 800',
  city: 'New York, NY 10004',
  phone: '(800) 555-0192',
  tin: '98-7654321',
}

const TRANSACTIONS = [
  {
    description: '50 SH APPLE INC',
    symbol: 'AAPL',
    acquired: '01/15/2024',
    sold: '08/20/2024',
    proceeds: '9,450.00',
    basis: '7,500.00',
    gain: '1,950.00',
    term: 'Short-term',
    withheld: '0.00',
    covered: true,
  },
  {
    description: '25 SH MICROSOFT CORP',
    symbol: 'MSFT',
    acquired: '03/10/2023',
    sold: '04/15/2024',
    proceeds: '8,725.00',
    basis: '6,200.00',
    gain: '2,525.00',
    term: 'Long-term',
    withheld: '0.00',
    covered: true,
  },
  {
    description: '10 SH NVIDIA CORP',
    symbol: 'NVDA',
    acquired: '02/01/2024',
    sold: '09/30/2024',
    proceeds: '12,350.00',
    basis: '8,800.00',
    gain: '3,550.00',
    term: 'Short-term',
    withheld: '0.00',
    covered: true,
  },
]

const TOTALS = {
  proceeds: '30,525.00',
  basis: '22,500.00',
  gain: '8,025.00',
  withheld: '0.00',
}

// ─── 1099-B HTML ─────────────────────────────────────────────────────────────

const form1099bHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Form 1099-B — Apex Brokerage Inc.</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 10px; color: #000; background: #fff; padding: 32px; }
    h1 { font-size: 18px; font-weight: bold; margin-bottom: 2px; }
    h2 { font-size: 12px; font-weight: normal; color: #444; margin-bottom: 16px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 16px; }
    .header-left h1 { font-size: 20px; }
    .header-right { text-align: right; font-size: 9px; color: #333; }
    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
    .box { border: 1px solid #999; padding: 8px 10px; }
    .box-label { font-size: 8px; font-weight: bold; color: #555; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
    .box-value { font-size: 11px; font-weight: bold; }
    .box-sub { font-size: 9px; color: #444; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    thead tr { background: #1a3a6e; color: #fff; }
    thead th { padding: 6px 8px; text-align: left; font-size: 9px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.4px; }
    tbody tr { border-bottom: 1px solid #ddd; }
    tbody tr:nth-child(even) { background: #f7f9ff; }
    tbody td { padding: 6px 8px; font-size: 10px; }
    .num { text-align: right; }
    tfoot tr { background: #e8edf7; font-weight: bold; border-top: 2px solid #1a3a6e; }
    tfoot td { padding: 6px 8px; font-size: 10px; }
    .badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 8px; font-weight: bold; }
    .short { background: #fef3cd; color: #856404; }
    .long  { background: #d1e7dd; color: #0a3622; }
    .footer-note { font-size: 8px; color: #555; border-top: 1px solid #ccc; padding-top: 8px; line-height: 1.6; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
    .sum-box { border: 1px solid #ccc; padding: 8px; text-align: center; }
    .sum-label { font-size: 8px; color: #555; margin-bottom: 4px; }
    .sum-value { font-size: 13px; font-weight: bold; color: #1a3a6e; }
  </style>
</head>
<body>

  <div class="header">
    <div class="header-left">
      <h1>Apex Brokerage Inc.</h1>
      <p style="font-size:9px; color:#555;">${BROKER.address}, ${BROKER.city}</p>
      <p style="font-size:9px; color:#555;">Phone: ${BROKER.phone} &nbsp;|&nbsp; Payer TIN: ${BROKER.tin}</p>
    </div>
    <div class="header-right">
      <div style="font-size:16px; font-weight:bold; color:#1a3a6e;">FORM 1099-B</div>
      <div style="font-size:9px;">Proceeds from Broker and</div>
      <div style="font-size:9px;">Barter Exchange Transactions</div>
      <div style="margin-top:4px; font-size:9px;">Tax Year <strong>2024</strong></div>
      <div style="font-size:8px; color:#888;">OMB No. 1545-0715</div>
    </div>
  </div>

  <div class="parties">
    <div class="box">
      <div class="box-label">PAYER (Broker)</div>
      <div class="box-value">${BROKER.name}</div>
      <div class="box-sub">${BROKER.address}</div>
      <div class="box-sub">${BROKER.city}</div>
      <div class="box-sub">TIN: ${BROKER.tin}</div>
    </div>
    <div class="box">
      <div class="box-label">RECIPIENT (Taxpayer)</div>
      <div class="box-value">${TAXPAYER.name}</div>
      <div class="box-sub">${TAXPAYER.address}</div>
      <div class="box-sub">${TAXPAYER.city}</div>
      <div class="box-sub">SSN: ${TAXPAYER.ssn}</div>
    </div>
  </div>

  <div class="summary">
    <div class="sum-box">
      <div class="sum-label">Total Proceeds (Box 1d)</div>
      <div class="sum-value">$${TOTALS.proceeds}</div>
    </div>
    <div class="sum-box">
      <div class="sum-label">Total Cost Basis (Box 1e)</div>
      <div class="sum-value">$${TOTALS.basis}</div>
    </div>
    <div class="sum-box">
      <div class="sum-label">Total Gain / Loss</div>
      <div class="sum-value" style="color:#0a6640;">$${TOTALS.gain}</div>
    </div>
    <div class="sum-box">
      <div class="sum-label">Federal Tax Withheld (Box 4)</div>
      <div class="sum-value">$${TOTALS.withheld}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Box 1a — Description</th>
        <th>Box 1b — Date Acquired</th>
        <th>Box 1c — Date Sold</th>
        <th class="num">Box 1d — Proceeds</th>
        <th class="num">Box 1e — Cost Basis</th>
        <th class="num">Gain / Loss</th>
        <th>Term</th>
        <th>Covered</th>
      </tr>
    </thead>
    <tbody>
      ${TRANSACTIONS.map(t => `
      <tr>
        <td><strong>${t.symbol}</strong> — ${t.description}</td>
        <td>${t.acquired}</td>
        <td>${t.sold}</td>
        <td class="num">$${t.proceeds}</td>
        <td class="num">$${t.basis}</td>
        <td class="num" style="color:#0a6640;">$${t.gain}</td>
        <td><span class="badge ${t.term === 'Short-term' ? 'short' : 'long'}">${t.term}</span></td>
        <td style="text-align:center;">${t.covered ? '✓' : '—'}</td>
      </tr>`).join('')}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="3"><strong>TOTALS</strong></td>
        <td class="num">$${TOTALS.proceeds}</td>
        <td class="num">$${TOTALS.basis}</td>
        <td class="num" style="color:#0a6640;">$${TOTALS.gain}</td>
        <td colspan="2"></td>
      </tr>
    </tfoot>
  </table>

  <div class="footer-note">
    <strong>Important tax information:</strong> This is important tax information and is being furnished to the Internal Revenue Service.
    If you are required to file a return, a negligence penalty or other sanction may be imposed on you if this income is taxable and the IRS
    determines that it has not been reported. Transactions in boxes 1d and 1e for covered securities are reported to the IRS.
    Short-term transactions are reported on Form 8949, Part I. Long-term transactions are reported on Form 8949, Part II.
    &nbsp;|&nbsp; Account: ****4872 &nbsp;|&nbsp; Statement Date: January 31, 2025
  </div>

</body>
</html>`

// ─── Form 8949 HTML ───────────────────────────────────────────────────────────

const form8949Html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Form 8949 — Sales and Other Dispositions of Capital Assets</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #111; background: #f5f5f5; }
    .page { max-width: 900px; margin: 32px auto; background: #fff; border: 1px solid #ccc; padding: 40px; }
    h1 { font-size: 20px; font-weight: bold; text-align: center; margin-bottom: 4px; }
    .subtitle { font-size: 12px; text-align: center; color: #555; margin-bottom: 24px; }
    .omb { text-align: right; font-size: 10px; color: #888; margin-bottom: 8px; }
    .section { margin-bottom: 24px; }
    .section-title { font-size: 14px; font-weight: bold; background: #1a3a6e; color: #fff; padding: 6px 10px; margin-bottom: 12px; }
    label { display: block; font-size: 11px; color: #444; margin-bottom: 3px; font-weight: bold; }
    input[type=text] {
      width: 100%; border: 1px solid #aaa; border-radius: 4px; padding: 8px 10px;
      font-size: 13px; background: #fafbff; transition: border-color 0.2s;
    }
    input[type=text]:focus { outline: none; border-color: #4f46e5; box-shadow: 0 0 0 2px rgba(79,70,229,0.15); }
    .row { display: grid; gap: 16px; margin-bottom: 14px; }
    .row-2 { grid-template-columns: 1fr 1fr; }
    .row-3 { grid-template-columns: 1fr 1fr 1fr; }
    .row-4 { grid-template-columns: 1fr 1fr 1fr 1fr; }
    .row-5 { grid-template-columns: repeat(5, 1fr); }
    .field { display: flex; flex-direction: column; }
    .box-num { display: inline-block; background: #1a3a6e; color: #fff; font-size: 9px; padding: 1px 5px; border-radius: 2px; margin-bottom: 3px; width: fit-content; }
    .part-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
    .part-label { background: #e8edf7; border-left: 4px solid #1a3a6e; padding: 6px 12px; font-size: 12px; font-weight: bold; }
    .hint { font-size: 10px; color: #888; font-weight: normal; }
    .divider { border: none; border-top: 1px solid #ddd; margin: 20px 0; }
    .submit-row { text-align: center; margin-top: 24px; }
    button {
      background: linear-gradient(135deg, #4f46e5, #7c3aed);
      color: #fff; border: none; padding: 12px 36px; border-radius: 8px;
      font-size: 14px; font-weight: bold; cursor: pointer;
    }
  </style>
</head>
<body>
<div class="page">
  <div class="omb">OMB No. 1545-0074 | Attachment Sequence No. 12A</div>
  <h1>Form 8949</h1>
  <p class="subtitle">Sales and Other Dispositions of Capital Assets<br>
    <span style="font-size:11px;">Attach to Schedule D. Use Form 8949 to list your transactions for lines 1b, 2, 3, 8b, 9, and 10 of Schedule D.</span>
  </p>

  <div class="section">
    <div class="section-title">Taxpayer Information</div>
    <div class="row row-2">
      <div class="field">
        <label>Full Name (as shown on return)</label>
        <input type="text" id="taxpayer_name" name="taxpayer_name" placeholder="John A. Smith" />
      </div>
      <div class="field">
        <label>Social Security Number (SSN)</label>
        <input type="text" id="ssn" name="ssn" placeholder="XXX-XX-XXXX" />
      </div>
    </div>
    <div class="row row-2">
      <div class="field">
        <label>Street Address</label>
        <input type="text" id="address" name="address" placeholder="742 Evergreen Terrace" />
      </div>
      <div class="field">
        <label>City, State, ZIP</label>
        <input type="text" id="city_state_zip" name="city_state_zip" placeholder="Springfield, IL 62701" />
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Part I — Short-Term Transactions (Assets held 1 year or less)</div>
    <p style="font-size:11px; color:#555; margin-bottom:12px;">
      Check applicable box: Transactions reported on Form 1099-B showing basis was reported to the IRS <strong>(A)</strong>
    </p>

    <hr class="divider" />
    <p style="font-size:11px; font-weight:bold; margin-bottom:10px;">Transaction 1 — AAPL</p>
    <div class="row row-3">
      <div class="field">
        <span class="box-num">Box 1a</span>
        <label>Description of Property</label>
        <input type="text" id="st1_description" name="st1_description" placeholder="50 SH APPLE INC" />
      </div>
      <div class="field">
        <span class="box-num">Box 1b</span>
        <label>Date Acquired</label>
        <input type="text" id="st1_date_acquired" name="st1_date_acquired" placeholder="MM/DD/YYYY" />
      </div>
      <div class="field">
        <span class="box-num">Box 1c</span>
        <label>Date Sold or Disposed</label>
        <input type="text" id="st1_date_sold" name="st1_date_sold" placeholder="MM/DD/YYYY" />
      </div>
    </div>
    <div class="row row-4">
      <div class="field">
        <span class="box-num">Box 1d</span>
        <label>Proceeds (Sales Price)</label>
        <input type="text" id="st1_proceeds" name="st1_proceeds" placeholder="0.00" />
      </div>
      <div class="field">
        <span class="box-num">Box 1e</span>
        <label>Cost or Other Basis</label>
        <input type="text" id="st1_basis" name="st1_basis" placeholder="0.00" />
      </div>
      <div class="field">
        <label>Adjustment Code <span class="hint">(if any)</span></label>
        <input type="text" id="st1_adj_code" name="st1_adj_code" placeholder="—" />
      </div>
      <div class="field">
        <label>Gain or (Loss)</label>
        <input type="text" id="st1_gain" name="st1_gain" placeholder="0.00" />
      </div>
    </div>

    <hr class="divider" />
    <p style="font-size:11px; font-weight:bold; margin-bottom:10px;">Transaction 2 — NVDA</p>
    <div class="row row-3">
      <div class="field">
        <span class="box-num">Box 1a</span>
        <label>Description of Property</label>
        <input type="text" id="st2_description" name="st2_description" placeholder="10 SH NVIDIA CORP" />
      </div>
      <div class="field">
        <span class="box-num">Box 1b</span>
        <label>Date Acquired</label>
        <input type="text" id="st2_date_acquired" name="st2_date_acquired" placeholder="MM/DD/YYYY" />
      </div>
      <div class="field">
        <span class="box-num">Box 1c</span>
        <label>Date Sold or Disposed</label>
        <input type="text" id="st2_date_sold" name="st2_date_sold" placeholder="MM/DD/YYYY" />
      </div>
    </div>
    <div class="row row-4">
      <div class="field">
        <span class="box-num">Box 1d</span>
        <label>Proceeds (Sales Price)</label>
        <input type="text" id="st2_proceeds" name="st2_proceeds" placeholder="0.00" />
      </div>
      <div class="field">
        <span class="box-num">Box 1e</span>
        <label>Cost or Other Basis</label>
        <input type="text" id="st2_basis" name="st2_basis" placeholder="0.00" />
      </div>
      <div class="field">
        <label>Adjustment Code <span class="hint">(if any)</span></label>
        <input type="text" id="st2_adj_code" name="st2_adj_code" placeholder="—" />
      </div>
      <div class="field">
        <label>Gain or (Loss)</label>
        <input type="text" id="st2_gain" name="st2_gain" placeholder="0.00" />
      </div>
    </div>

    <hr class="divider" />
    <div class="row row-2">
      <div class="field">
        <label><strong>Part I Total — Short-Term Proceeds</strong></label>
        <input type="text" id="st_total_proceeds" name="st_total_proceeds" placeholder="0.00" />
      </div>
      <div class="field">
        <label><strong>Part I Total — Short-Term Gain / Loss</strong></label>
        <input type="text" id="st_total_gain" name="st_total_gain" placeholder="0.00" />
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Part II — Long-Term Transactions (Assets held more than 1 year)</div>
    <p style="font-size:11px; color:#555; margin-bottom:12px;">
      Check applicable box: Transactions reported on Form 1099-B showing basis was reported to the IRS <strong>(D)</strong>
    </p>

    <hr class="divider" />
    <p style="font-size:11px; font-weight:bold; margin-bottom:10px;">Transaction 1 — MSFT</p>
    <div class="row row-3">
      <div class="field">
        <span class="box-num">Box 1a</span>
        <label>Description of Property</label>
        <input type="text" id="lt1_description" name="lt1_description" placeholder="25 SH MICROSOFT CORP" />
      </div>
      <div class="field">
        <span class="box-num">Box 1b</span>
        <label>Date Acquired</label>
        <input type="text" id="lt1_date_acquired" name="lt1_date_acquired" placeholder="MM/DD/YYYY" />
      </div>
      <div class="field">
        <span class="box-num">Box 1c</span>
        <label>Date Sold or Disposed</label>
        <input type="text" id="lt1_date_sold" name="lt1_date_sold" placeholder="MM/DD/YYYY" />
      </div>
    </div>
    <div class="row row-4">
      <div class="field">
        <span class="box-num">Box 1d</span>
        <label>Proceeds (Sales Price)</label>
        <input type="text" id="lt1_proceeds" name="lt1_proceeds" placeholder="0.00" />
      </div>
      <div class="field">
        <span class="box-num">Box 1e</span>
        <label>Cost or Other Basis</label>
        <input type="text" id="lt1_basis" name="lt1_basis" placeholder="0.00" />
      </div>
      <div class="field">
        <label>Adjustment Code <span class="hint">(if any)</span></label>
        <input type="text" id="lt1_adj_code" name="lt1_adj_code" placeholder="—" />
      </div>
      <div class="field">
        <label>Gain or (Loss)</label>
        <input type="text" id="lt1_gain" name="lt1_gain" placeholder="0.00" />
      </div>
    </div>

    <hr class="divider" />
    <div class="row row-2">
      <div class="field">
        <label><strong>Part II Total — Long-Term Proceeds</strong></label>
        <input type="text" id="lt_total_proceeds" name="lt_total_proceeds" placeholder="0.00" />
      </div>
      <div class="field">
        <label><strong>Part II Total — Long-Term Gain / Loss</strong></label>
        <input type="text" id="lt_total_gain" name="lt_total_gain" placeholder="0.00" />
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Broker Information (from 1099-B)</div>
    <div class="row row-3">
      <div class="field">
        <label>Broker / Payer Name</label>
        <input type="text" id="broker_name" name="broker_name" placeholder="Apex Brokerage Inc." />
      </div>
      <div class="field">
        <label>Broker TIN</label>
        <input type="text" id="broker_tin" name="broker_tin" placeholder="XX-XXXXXXX" />
      </div>
      <div class="field">
        <label>Federal Income Tax Withheld (Box 4)</label>
        <input type="text" id="federal_tax_withheld" name="federal_tax_withheld" placeholder="0.00" />
      </div>
    </div>
  </div>

  <div class="submit-row">
    <button type="button">Submit Form</button>
  </div>
</div>
</body>
</html>`

// ─── Generate files ───────────────────────────────────────────────────────────

// Write Form 8949 HTML
const form8949Path = resolve(HTML_DIR, 'form-8949.html')
writeFileSync(form8949Path, form8949Html, 'utf8')
console.log(`✓ Written: ${form8949Path}`)

// Generate 1099-B PDF via Playwright
console.log('\n⏳ Launching browser to generate 1099-B PDF…')
const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent(form1099bHtml, { waitUntil: 'domcontentloaded' })

const pdfPath = resolve(PDF_DIR, '1099b-apex-brokerage.pdf')
await page.pdf({
  path: pdfPath,
  format: 'Letter',
  printBackground: true,
  margin: { top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' },
})
await browser.close()

console.log(`✓ Written: ${pdfPath}`)
console.log(`
────────────────────────────────────────────────
  Demo documents ready in demo/

  Source doc  : output/pdf/1099b-apex-brokerage.pdf
               (index this in FormBuddy)

  Form to fill: output/html/form-8949.html
               (open in browser, use FormBuddy to fill)

  Taxpayer    : John A. Smith  |  SSN: 123-45-6789
  Transactions: AAPL (short), MSFT (long), NVDA (short)
  Total gain  : $8,025.00
────────────────────────────────────────────────
`)
