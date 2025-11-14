// Node 18+ (has global fetch)
// Usage: node parseTableGrid.js
// Replace exampleUrl with your actual published doc URL.

const exampleUrl = 'https://docs.google.com/document/d/e/2PACX-1vSZ9d7OCd4QMsjJi2VFQmPYLebG2sGqI879_bSPugwOo_fgRcZLAFyfajPWU91UDiLg-RxRD41lVYRA/pub';

function decodeHtmlEntities(str) {
  if (!str) return '';
  // basic named entities + numeric entities
  const named = {
    nbsp: ' ',
    lt: '<',
    gt: '>',
    amp: '&',
    quot: '"',
    apos: "'",
  };
  // replace numeric entities
  str = str.replace(/&#(\d+);?/g, (_m, n) => String.fromCodePoint(Number(n)));
  str = str.replace(/&#x([0-9a-fA-F]+);?/g, (_m, n) => String.fromCodePoint(parseInt(n, 16)));
  // replace named entities
  str = str.replace(/&([a-zA-Z]+);?/g, (_, name) => named[name] ?? `&${name};`);
  return str;
}

// strip tags but keep inner text, collapse whitespace
function stripTags(html) {
  if (html === null || html === undefined) return '';
  // remove script/style
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '')
             .replace(/<style[\s\S]*?<\/style>/gi, '');
  // replace <br> and block tags with newline to preserve cell breaks
  html = html.replace(/<(br|BR|p|div)[^>]*>/g, '\n');
  // remove all tags
  let text = html.replace(/<\/?[^>]+>/g, '');
  // decode entities
  text = decodeHtmlEntities(text);
  // collapse whitespace, trim
  text = text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
  return text;
}

async function fetchHtml(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
  const text = await res.text();
  return text;
}

// Find candidate tables and return first table HTML that contains the header labels (case-insensitive)
function findTableWithHeader(html, headerTokens = ['x-coordinate','character','y-coordinate']) {
  // find all <table ...>...</table>
  const tables = Array.from(html.matchAll(/<table[\s\S]*?<\/table>/gi), m => m[0]);
  for (const tbl of tables) {
    const plain = tbl.replace(/<[^>]+>/g, '').toLowerCase();
    let matchesAll = true;
    for (const token of headerTokens) {
      if (!plain.includes(token.toLowerCase())) { matchesAll = false; break; }
    }
    if (matchesAll) return tbl;
  }
  // fallback: return first table if none matched headers
  return tables.length ? tables[0] : null;
}

// Extract an array of cell texts (in document order) from table HTML
function extractCellsFromTable(tableHtml) {
  if (!tableHtml) return [];
  // find all <td>...</td> (and <th>...</th>) in order
  const cellMatches = Array.from(tableHtml.matchAll(/<(td|th)[\s\S]*?<\/\1>/gi), m => m[0]);
  const cells = cellMatches.map(cellHtml => stripTags(cellHtml));
  // normalize: remove empty header labels like repeated empty strings
  return cells.filter(c => c !== null).map(s => s.trim());
}

// Given a stream of tokens (cell texts), remove typical header tokens and return the data tokens
function normalizeTokens(tokens) {
  const headers = new Set(['x-coordinate','x coordinate','x','character','y-coordinate','y coordinate','y']);
  return tokens.filter(t => {
    if (!t) return false;
    const low = t.toLowerCase();
    return !headers.has(low);
  });
}

// parse tokens into (x,char,y) triples.
// the table you showed uses triples: [x, character, y] repeating.
// we are defensive and test permutations.
function parseTriples(tokens) {
  const isNumber = s => /^-?\d+$/.test(s);
  const looksLikeChar = s => typeof s === 'string' && s.length > 0 && !isNumber(s);

  // if tokens come in rows (one table row = 3 cells) then we'll group by 3
  let t = tokens.slice();

  // If length isn't multiple of 3, try to drop leading/trailing header remnants
  if (t.length % 3 !== 0) {
    // try to find first index where remaining length is multiple of 3
    for (let start = 0; start < 3; start++) {
      const slice = tokens.slice(start);
      if (slice.length % 3 === 0) { t = slice; break; }
    }
  }

  const triples = [];
  // attempt to interpret as [x, char, y]
  let successXCharY = 0;
  for (let i = 0; i + 2 < t.length; i += 3) {
    const a = t[i], b = t[i+1], c = t[i+2];
    if (isNumber(a) && looksLikeChar(b) && isNumber(c)) {
      triples.push({ x: Number(a), y: Number(c), ch: Array.from(b)[0] });
      successXCharY++;
    } else {
      triples.push(null); // placeholder; we'll try other permutations later
    }
  }
  if (successXCharY > 0) {
    // filter nulls
    return triples.filter(Boolean);
  }

  // try [x, y, char]
  const found2 = [];
  for (let i = 0; i + 2 < t.length; i += 3) {
    const a = t[i], b = t[i+1], c = t[i+2];
    if (isNumber(a) && isNumber(b) && looksLikeChar(c)) {
      found2.push({ x: Number(a), y: Number(b), ch: Array.from(c)[0] });
    }
  }
  if (found2.length > 0) return found2;

  // try [char, x, y]
  const found3 = [];
  for (let i = 0; i + 2 < t.length; i += 3) {
    const a = t[i], b = t[i+1], c = t[i+2];
    if (looksLikeChar(a) && isNumber(b) && isNumber(c)) {
      found3.push({ x: Number(b), y: Number(c), ch: Array.from(a)[0] });
    }
  }
  if (found3.length > 0) return found3;

  // fallback: try to parse lines that include two numbers on same line (line-based rows)
  const fallback = [];
  for (const line of tokens) {
    const nums = (line.match(/-?\d+/g) || []);
    if (nums.length >= 2) {
      const x = Number(nums[0]), y = Number(nums[1]);
      // detect char via U+ or quoted char or leftover
      let ch = null;
      const um = line.match(/U\+([0-9A-Fa-f]{1,6})/);
      if (um) ch = String.fromCodePoint(parseInt(um[1], 16));
      else {
        const q = line.match(/'(.*?)'|"(.*?)"|`(.*?)`/);
        if (q) ch = q.slice(1).find(Boolean);
        else {
          const rest = line.replace(/-?\d+/g, '').replace(/[:,()\[\]{}<>]/g, '').trim();
          if (rest) ch = Array.from(rest)[0];
        }
      }
      if (ch) fallback.push({ x, y, ch: Array.from(ch)[0] });
    }
  }
  return fallback;
}

function buildAndPrintGrid(triples) {
  if (!triples || triples.length === 0) {
    console.warn('No triples to build grid from.');
    return;
  }
  const map = new Map();
  let maxX = 0, maxY = 0;
  for (const rec of triples) {
    const { x, y, ch } = rec;
    if (!Number.isFinite(x) || !Number.isFinite(y) || ch === undefined || ch === null) continue;
    map.set(`${x},${y}`, ch);
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  // Safety: if grid is very large, warn
  const width = maxX + 1, height = maxY + 1;
  if (width * height > 5_000_000) {
    console.warn(`Grid is large (${width}x${height}). You may want to print a bounding box only.`);
  }
  for (let y = 0; y < height; y++) {
    const row = new Array(width).fill(' ');
    for (let x = 0; x < width; x++) {
      const key = `${x},${y}`;
      if (map.has(key)) row[x] = map.get(key);
    }
    console.log(row.join(''));
  }
}

async function parseTableUrl(url) {
  console.log('Fetching URL:', url);
  const html = await fetchHtml(url);
  const tableHtml = findTableWithHeader(html);
  if (!tableHtml) {
    throw new Error('No <table> found in HTML.');
  }
  const cells = extractCellsFromTable(tableHtml);
  if (!cells.length) {
    throw new Error('No table cells found.');
  }
  const dataTokens = normalizeTokens(cells);

  console.log('Total table cells:', cells.length, 'Data tokens (after removing headers):', dataTokens.length);
  const triples = parseTriples(dataTokens);
  console.log('Parsed records:', triples.length);
  if (triples.length === 0) {
    console.log('Sample tokens (first 30):', dataTokens.slice(0,30));
    throw new Error('Could not parse any (x,char,y) records from the table.');
  }
  buildAndPrintGrid(triples);
}

// run
(async () => {
  try {
    await parseTableUrl(exampleUrl);
  } catch (err) {
    console.error('Error:', err.message);
  }
})();

