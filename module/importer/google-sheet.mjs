/**
 * Google Sheets download: READ-ONLY by construction.
 *
 * This is the only file in the system that talks to Google, and it can only read:
 *  - It only ever builds one kind of URL, the public "export as .xlsx" link
 *      https://docs.google.com/spreadsheets/d/<id>/export?format=xlsx
 *    which returns a copy of the spreadsheet. That endpoint has no way to change anything.
 *  - It only sends a plain GET with no body.
 *  - It sends no credentials (credentials: "omit", no cookies, no tokens, no API keys), so Google treats it as an
 *    anonymous visitor. Editing a Google Sheet always requires a signed-in account with edit rights; an anonymous
 *    request cannot edit even if it tried.
 *  - The sheet therefore has to be shared as "Anyone with the link → Viewer". Viewer access is all that's needed.
 */

const ID_RE = /^[A-Za-z0-9_-]{20,}$/;
const LINK_RE = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})(?:[/?#].*)?$/;

/**
 * Accepts a full Google Sheets link (any tab, any /edit, /view, ?usp=… suffix) or a bare spreadsheet id.
 * @returns {string} the spreadsheet id
 */
export function parseSheetLink(link) {
  const s = String(link ?? "").trim();
  if (ID_RE.test(s)) return s;
  const m = LINK_RE.exec(s);
  if (!m) throw new SheetError("badLink");
  return m[1];
}

/** The only URL this system ever requests from Google. */
export function exportUrl(id) {
  if (!ID_RE.test(id)) throw new SheetError("badLink");
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
}

export class SheetError extends Error {
  constructor(code, detail = "") {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Download a copy of the whole spreadsheet as .xlsx.
 * @param {string} link   a Google Sheets link or id
 * @returns {Promise<ArrayBuffer>}
 */
export async function downloadSheet(link) {
  const url = exportUrl(parseSheetLink(link));
  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      mode: "cors",
      redirect: "follow",
      referrerPolicy: "no-referrer"
    });
  } catch (err) {
    throw new SheetError("network", err.message);
  }
  if (!res.ok) throw new SheetError(res.status === 401 || res.status === 403 || res.status === 404 ? "notShared" : "http", String(res.status));
  const buffer = await res.arrayBuffer();
  const head = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
  // .xlsx files are zip archives ("PK"); anything else is Google's sign-in or error page
  if (head[0] !== 0x50 || head[1] !== 0x4b) throw new SheetError("notShared", "not an xlsx");
  return buffer;
}
