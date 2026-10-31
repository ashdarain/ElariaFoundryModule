/**
 * Minimal, read-only .xlsx reader.
 *
 * Turns the bytes of a Google Sheets "Download as .xlsx" export into
 *   Map<sheetName, string[][]>   (row 0 = spreadsheet row 1, column 0 = column A)
 * with cell values rendered to text the same way as the original Python converter (openpyxl, data_only):
 * cached formula results, TRUE/FALSE for booleans, integers without ".0", dates as "YYYY-MM-DD HH:MM:SS".
 *
 * No dependencies: unzips with the platform's DecompressionStream (browsers, Electron, Node 18+) and scans
 * the XML with regular expressions (sheet XML is machine-written and regular). Nothing here can write.
 */

/* ------------------------------------------------------------------ */
/*  ZIP                                                                */
/* ------------------------------------------------------------------ */

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** @returns {Promise<Map<string, Uint8Array>>} only the entries we ask for */
async function unzip(buffer, wanted) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  // End of central directory record: search backwards for 0x06054b50
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a valid .xlsx file (zip directory not found).");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("Corrupt .xlsx file (bad zip entry).");
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const data = bytes.subarray(start, start + compSize);
    if (method === 0) out.set(name, data);
    else if (method === 8) out.set(name, await inflateRaw(data));
    else throw new Error(`Unsupported compression in ${name}.`);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  XML helpers                                                        */
/* ------------------------------------------------------------------ */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

function decodeXML(s) {
  return s
    .replace(/\r\n?/g, "\n")                              // XML end-of-line normalisation
    .replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
      if (e[0] === "#") return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENTITIES[e];
    })
    // OOXML escapes control characters as _xHHHH_ (openpyxl unescapes these)
    .replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
}

const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decodeXML(m[1]) : null;
};

/** Text of a shared-string / inline-string item: all <t> runs, skipping phonetic <rPh> runs. */
function richText(xml) {
  const body = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += m[1] ? decodeXML(m[1]) : "";
  return out;
}

/* ------------------------------------------------------------------ */
/*  Values                                                             */
/* ------------------------------------------------------------------ */

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** Same idea as openpyxl.styles.numbers.is_date_format. */
function isDateFormat(code) {
  if (!code) return false;
  const stripped = code.replace(/\[(?!(?:h|hh|m|mm|s|ss)\])[^\]]*\]/gi, "").replace(/"[^"]*"/g, "").replace(/\\./g, "");
  if (/^General$/i.test(stripped.trim())) return false;
  return /[dmyhs]/i.test(stripped.split(";")[0]);
}

const pad = (n, w = 2) => String(n).padStart(w, "0");

/** Excel serial → "YYYY-MM-DD HH:MM:SS" (or "HH:MM:SS" for pure times), like str(datetime) in Python. */
function serialToText(serial) {
  if (serial >= 0 && serial < 1) {
    const secs = Math.round(serial * 86400);
    return `${pad(Math.floor(secs / 3600))}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)}`;
  }
  let days = Math.floor(serial);
  if (days < 60) days += 1;                              // Excel's 1900 leap-year bug
  const ms = Math.round((serial - Math.floor(serial)) * 86400) * 1000;
  const d = new Date(Date.UTC(1899, 11, 30) + days * 86400000 + ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} `
    + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Python's repr(float) for the non-integer case (shortest round-trip, Python-style exponent). */
function pyFloat(n) {
  let s = String(n);
  if (/e/.test(s)) {
    const [mant, exp] = s.split("e");
    const e = Number(exp);
    s = `${mant}e${e < 0 ? "-" : "+"}${pad(Math.abs(e))}`;
  }
  return s;
}

function numberText(raw, isDate) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  if (isDate) return serialToText(n);
  // openpyxl: no '.'/'E' in the stored text → int, otherwise float; integral floats print without ".0"
  if (Number.isInteger(n)) return String(n);
  return pyFloat(n);
}

function colIndex(ref) {
  let c = 0;
  for (const ch of ref.replace(/\d+$/, "")) c = c * 26 + (ch.charCodeAt(0) - 64);
  return c - 1;
}

/* ------------------------------------------------------------------ */
/*  Workbook                                                           */
/* ------------------------------------------------------------------ */

/**
 * @param {ArrayBuffer} buffer   the .xlsx bytes
 * @returns {Promise<Map<string, string[][]>>}
 */
export async function readXlsx(buffer) {
  const files = await unzip(buffer, n =>
    n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels" || n === "xl/sharedStrings.xml"
    || n === "xl/styles.xml" || /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  const text = name => files.has(name) ? new TextDecoder().decode(files.get(name)) : "";

  // shared strings
  const shared = [];
  for (const m of text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) shared.push(m[1] ? richText(m[1]) : "");

  // which style indexes are dates
  const styles = text("xl/styles.xml");
  const customFormats = new Map();
  for (const m of styles.matchAll(/<numFmt\s[^>]*>/g)) customFormats.set(Number(attr(m[0], "numFmtId")), attr(m[0], "formatCode"));
  const dateStyles = new Set();
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
  let xfIndex = 0;
  for (const m of xfs.matchAll(/<xf\s[^>]*?(?:\/>|>)/g)) {
    const id = Number(attr(m[0], "numFmtId") ?? 0);
    if (BUILTIN_DATE_FORMATS.has(id) || isDateFormat(customFormats.get(id))) dateStyles.add(xfIndex);
    xfIndex++;
  }

  // sheet order and file paths
  const rels = new Map();
  for (const m of text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\s[^>]*>/g)) {
    let target = attr(m[0], "Target");
    target = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    rels.set(attr(m[0], "Id"), target);
  }
  const sheets = new Map();
  for (const m of text("xl/workbook.xml").matchAll(/<sheet\s[^>]*>/g)) {
    const name = attr(m[0], "name");
    const path = rels.get(attr(m[0], "r:id"));
    sheets.set(name, readSheet(text(path), shared, dateStyles));
  }
  return sheets;
}

function readSheet(xml, shared, dateStyles) {
  const rows = [];
  let rowIdx = -1;
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = attr(rm[1], "r");
    rowIdx = r ? Number(r) - 1 : rowIdx + 1;
    if (!rm[2]) continue;
    const row = [];
    let colIdx = -1;
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cm[1], "r");
      colIdx = ref ? colIndex(ref) : colIdx + 1;
      const body = cm[2];
      if (!body) continue;
      const type = attr(cm[1], "t") ?? "n";
      const style = Number(attr(cm[1], "s") ?? 0);
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      switch (type) {
        case "s": value = v === undefined ? "" : (shared[Number(v)] ?? ""); break;
        case "inlineStr": value = richText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? ""); break;
        case "str": case "e": value = v === undefined ? "" : decodeXML(v); break;
        case "b": value = v === undefined ? "" : (v === "1" || v === "true" ? "TRUE" : "FALSE"); break;
        case "d": value = v === undefined ? "" : decodeXML(v).replace("T", " ").replace(/\.\d+$/, "").replace(/Z$/, ""); break;
        default: value = v === undefined ? "" : numberText(v, dateStyles.has(style));
      }
      if (value === "") continue;
      while (rows.length <= rowIdx) rows.push([]);
      const target = rows[rowIdx];
      while (target.length < colIdx) target.push("");
      target[colIdx] = value;
    }
  }
  // drop trailing empty rows (as the Python loader does)
  while (rows.length && !rows[rows.length - 1].some(v => v)) rows.pop();
  return rows;
}
