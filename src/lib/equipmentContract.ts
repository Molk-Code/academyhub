// Shared HTML template for the printable/downloadable equipment loan contract.
// Layout mirrors the school's official "Equipment Contract" paper form
// (Region Värmland / Molkom Folk High School).

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
}

const LEGAL_TEXT =
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
  const items = opts.items.length > 0 ? opts.items : [{ product: '', time: '' }]
  const itemRows = items
    .map(
      i => `
      <tr>
        <td class="ec-cell ec-time">${esc(i.time)}</td>
        <td class="ec-cell">${esc(i.product)}</td>
      </tr>`,
    )
    .join('')

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Equipment Contract — ${esc(opts.projectName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; padding: 32px; }
  table.ec { width: 100%; max-width: 800px; margin: 0 auto; border-collapse: collapse; }
  table.ec td { border: 1px solid #999; padding: 8px 14px; font-size: 13px; vertical-align: middle; }
  .ec-label { width: 160px; font-weight: 700; background: #fafafa; }
  .ec-logo-cell { width: 160px; text-align: center; }
  .ec-logo { display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .ec-logo span { font-size: 10px; font-weight: 700; line-height: 1.15; color: #444; }
  .ec-title { font-size: 26px; text-align: center; padding: 18px 14px; }
  .ec-value-centered { text-align: center; }
  .ec-bold { font-weight: 700; }
  .ec-legal { font-size: 11px; line-height: 1.5; text-align: center; padding: 14px 24px; }
  .ec-highlight { background: #fbe0c4; }
  .ec-header-row td { font-weight: 700; }
  .ec-time { width: 160px; }
  .ec-sign-label { text-align: center; font-weight: 700; }
  .ec-sign-box { height: 110px; }
  .ec-footer { max-width: 800px; margin: 12px auto 0; font-size: 11px; color: #888; text-align: right; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <table class="ec">
    <tr>
      <td class="ec-logo-cell">
        <div class="ec-logo">
          <svg width="30" height="30" viewBox="0 0 32 32">
            <g fill="#e8794f">
              <circle cx="16" cy="8" r="7" />
              <circle cx="16" cy="24" r="7" />
              <circle cx="8" cy="16" r="7" />
              <circle cx="24" cy="16" r="7" />
            </g>
            <circle cx="16" cy="16" r="5" fill="#fff" />
          </svg>
          <span>Region<br />Värmland</span>
        </div>
      </td>
      <td class="ec-title">Equipment Contract</td>
    </tr>
    <tr>
      <td class="ec-label">Group/Project</td>
      <td class="ec-bold ec-value-centered">${esc(opts.projectName)}</td>
    </tr>
    <tr>
      <td class="ec-label">Name</td>
      <td class="ec-value-centered">${esc(opts.borrowerName) || '—'}</td>
    </tr>
    <tr>
      <td style="border:none"></td>
      <td class="ec-legal">${esc(LEGAL_TEXT)}</td>
    </tr>
    <tr class="ec-highlight">
      <td class="ec-label">Date from</td>
      <td class="ec-bold">${esc(opts.dateFrom)}</td>
    </tr>
    <tr class="ec-highlight">
      <td class="ec-label">Date to</td>
      <td class="ec-bold">${esc(opts.dateTo)}</td>
    </tr>
    <tr class="ec-header-row">
      <td>Checkout Time</td>
      <td>Product</td>
    </tr>
    ${itemRows}
    <tr>
      <td class="ec-sign-label">Sign</td>
      <td class="ec-sign-box"></td>
    </tr>
  </table>
  <div class="ec-footer">Generated ${new Date().toLocaleString()}</div>
</body>
</html>`
}
