// Shared HTML template for the printable/downloadable equipment loan contract.
// One A4 page: details, item list, full-width terms, signature (e-signature or
// blank lines for signing on paper).

import { cineforgeLogoDataUri as cineforgeLogo } from '@/assets/cineforgeLogoDataUri'

export interface EquipmentContractItem {
  product: string
  time?: string
}

export interface EquipmentContractOptions {
  projectName: string
  borrowerName: string
  dateFrom: string
  dateTo: string
  items: EquipmentContractItem[]
  // One paper signature line per borrower, name pre-printed (defaults to a single blank line)
  signers?: string[]
  // Terms as signed (defaults to the current LEGAL_TEXT)
  legalText?: string
  // Electronic signature, printed in the "Sign" box instead of leaving it blank
  signature?: {
    typedName: string
    accountName: string
    email: string
    signedAt: string
    ip: string
    contractHash: string
  }
}

// Keep in sync with LEGAL_TEXT in functions/src/equipment-signing.ts
export const LEGAL_TEXT =
  "The following items are loaned to the above-mentioned borrower. The borrowers are aware that by signing this " +
  "agreement, they are responsible for handling, storing, and transporting the equipment in such a way that no " +
  "damage or abnormal wear and tear occurs. If any damage occurs, it must be reported immediately to the school's " +
  "representatives for loaned equipment. If the equipment is stolen or lost, it will be reported to the police " +
  "immediately, followed by investigations from the police, the school, and the insurance company. The borrower " +
  "may be required to cover all or part of the costs to compensate the school, which should be kept free of costs " +
  "in the event of an incident. Molkom Folk High School applies full-value compensation if an item needs to be " +
  "replaced, i.e., if damage occurs or the item is lost, the borrower will be charged the same cost as it would " +
  "take to replace it with a new purchase."

function esc(s: string | undefined | null): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function buildEquipmentContractHtml(opts: EquipmentContractOptions): string {
  const hasTimes = opts.items.some(i => i.time)
  const itemRows = opts.items.length > 0
    ? opts.items.map((i, n) => `
        <tr>
          <td class="num">${n + 1}</td>
          <td>${esc(i.product)}</td>
          ${hasTimes ? `<td class="time">${esc(i.time)}</td>` : ''}
        </tr>`).join('')
    : `<tr><td class="num">1</td><td class="blank"></td>${hasTimes ? '<td></td>' : ''}</tr>
       <tr><td class="num">2</td><td class="blank"></td>${hasTimes ? '<td></td>' : ''}</tr>
       <tr><td class="num">3</td><td class="blank"></td>${hasTimes ? '<td></td>' : ''}</tr>`

  const sig = opts.signature
  const signBlock = sig
    ? `<div class="esign">
        <div class="esign-name">${esc(sig.typedName)}</div>
        <div class="esign-meta">
          Signed electronically in CineForge by ${esc(sig.accountName)} (${esc(sig.email)})<br/>
          ${esc(sig.signedAt)}${sig.ip ? ` &middot; IP ${esc(sig.ip)}` : ''}
        </div>
        <div class="esign-hash">Contract fingerprint (SHA-256)<br/>${esc(sig.contractHash)}</div>
      </div>`
    : (opts.signers?.length ? opts.signers : ['']).map(name => `<div class="paper-sign">
        <div><div class="line"></div><span>Signature</span></div>
        <div>${name ? `<div class="pre">${esc(name)}</div>` : '<div class="line"></div>'}<span>Name${name ? '' : ' in block letters'}</span></div>
        <div><div class="line"></div><span>Date</span></div>
      </div>`).join('')

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Equipment Contract — ${esc(opts.projectName)}</title>
<style>
  @page { size: A4; margin: 16mm 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; margin: 0; padding: 28px; font-size: 12px; line-height: 1.45; }
  .doc { max-width: 720px; margin: 0 auto; }
  header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 12px; border-bottom: 2px solid #1a1a1a; }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 13px; color: #444; }
  .brand img { width: 26px; height: 26px; object-fit: contain; }
  h1 { font-size: 22px; margin: 0; letter-spacing: -.01em; }
  h2 { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #666; margin: 0 0 6px; }
  section { margin-top: 18px; page-break-inside: avoid; break-inside: avoid; }
  .details { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #ccc; border-radius: 6px; overflow: hidden; }
  .details div { padding: 8px 12px; border-bottom: 1px solid #e3e3e3; }
  .details div:nth-child(odd) { border-right: 1px solid #e3e3e3; }
  .details div:nth-last-child(-n+2) { border-bottom: none; }
  .details .k { display: block; font-size: 10px; color: #777; text-transform: uppercase; letter-spacing: .06em; }
  .details .v { font-size: 13px; font-weight: 700; }
  .period { background: #fdf0e3; }
  table { width: 100%; border-collapse: collapse; }
  .items th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #777; font-weight: 700; padding: 6px 8px; border-bottom: 1px solid #ccc; }
  .items td { padding: 7px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  .items .num { width: 28px; color: #999; }
  .items .time { width: 150px; color: #555; white-space: nowrap; }
  .items .blank { height: 22px; }
  .terms p { margin: 0; font-size: 10.5px; line-height: 1.55; text-align: justify; hyphens: auto; color: #333; }
  .sign { border: 1px solid #ccc; border-radius: 6px; padding: 14px 16px; }
  .esign-name { font-size: 20px; font-weight: 700; font-style: italic; margin-bottom: 4px; }
  .esign-meta { font-size: 11px; color: #555; }
  .esign-hash { font-family: Menlo, Consolas, monospace; font-size: 9.5px; color: #777; margin-top: 8px; word-break: break-all; }
  .paper-sign { display: grid; grid-template-columns: 2fr 2fr 1fr; gap: 20px; padding-top: 28px; }
  .paper-sign .line { border-bottom: 1px solid #1a1a1a; height: 1px; }
  .paper-sign + .paper-sign { padding-top: 34px; }
  .paper-sign .pre { border-bottom: 1px solid #1a1a1a; font-size: 13px; font-weight: 700; padding-bottom: 2px; margin-top: -21px; line-height: 18px; }
  .paper-sign span { display: block; font-size: 10px; color: #777; margin-top: 4px; }
  footer { margin-top: 14px; font-size: 10px; color: #999; text-align: right; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<div class="doc">
  <header>
    <div class="brand"><img src="${cineforgeLogo}" alt="" />Cineforge</div>
    <h1>Equipment Contract</h1>
  </header>

  <section>
    <div class="details">
      <div><span class="k">Group / Project</span><span class="v">${esc(opts.projectName) || '—'}</span></div>
      <div><span class="k">Borrower</span><span class="v">${esc(opts.borrowerName) || '—'}</span></div>
      <div class="period"><span class="k">Date from</span><span class="v">${esc(opts.dateFrom) || '—'}</span></div>
      <div class="period"><span class="k">Date to</span><span class="v">${esc(opts.dateTo) || '—'}</span></div>
    </div>
  </section>

  <section>
    <h2>Equipment</h2>
    <table class="items">
      <thead><tr><th>#</th><th>Product</th>${hasTimes ? '<th>Checked out</th>' : ''}</tr></thead>
      <tbody>${itemRows}</tbody>
    </table>
  </section>

  <section class="terms">
    <h2>Terms</h2>
    <p>${esc(opts.legalText ?? LEGAL_TEXT)}</p>
  </section>

  <section>
    <h2>Signature</h2>
    <div class="sign">${signBlock}</div>
  </section>

  <footer>Generated ${esc(new Date().toLocaleString('sv-SE'))}</footer>
</div>
</body>
</html>`
}

// Open the contract in a new window and print it (same flow as "Download Contract PDF")
export function printEquipmentContract(opts: EquipmentContractOptions) {
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(buildEquipmentContractHtml(opts))
  win.document.close()
  let printed = false
  const doPrint = () => { if (printed) return; printed = true; win.print() }
  win.addEventListener('load', doPrint)
  setTimeout(doPrint, 500)
}
