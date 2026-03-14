/**
 * Lightweight RSS 2.0 / Atom parser — no dependencies.
 * Handles CDATA sections, common RSS fields, and Atom entries.
 */

export interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  categories: string[];
  contentEncoded: string;
  creator: string;
  guid: string;
}

export interface RSSFeed {
  title: string;
  link: string;
  description: string;
  items: RSSItem[];
}

function extractTag(xml: string, tag: string): string {
  // Handle CDATA: <tag><![CDATA[content]]></tag>
  const cdataRegex = new RegExp(
    `<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`,
    "i"
  );
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();

  // Handle regular content: <tag>content</tag>
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = xml.match(regex);
  return match ? decodeXmlEntities(match[1].trim()) : "";
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const regex = new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, "i");
  const match = xml.match(regex);
  return match ? match[1] : "";
}

function extractAllTags(xml: string, tag: string): string[] {
  const results: string[] = [];

  // CDATA version
  const cdataRegex = new RegExp(
    `<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`,
    "gi"
  );
  let match;
  while ((match = cdataRegex.exec(xml)) !== null) {
    results.push(match[1].trim());
  }

  // Plain version (only if no CDATA found)
  if (results.length === 0) {
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
    while ((match = regex.exec(xml)) !== null) {
      results.push(decodeXmlEntities(match[1].trim()));
    }
  }

  return results;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function splitItems(xml: string, openTag: string, closeTag: string): string[] {
  const items: string[] = [];
  let start = 0;

  while (true) {
    const openIdx = xml.indexOf(openTag, start);
    if (openIdx === -1) break;
    const closeIdx = xml.indexOf(closeTag, openIdx);
    if (closeIdx === -1) break;
    items.push(xml.slice(openIdx, closeIdx + closeTag.length));
    start = closeIdx + closeTag.length;
  }

  return items;
}

export function parseRSS(xml: string): RSSFeed {
  const isAtom = xml.includes("<feed") && xml.includes("xmlns=\"http://www.w3.org/2005/Atom\"");

  if (isAtom) {
    return parseAtom(xml);
  }

  const title = extractTag(xml, "title");
  const link = extractTag(xml, "link");
  const description = extractTag(xml, "description");

  const itemXmls = splitItems(xml, "<item>", "</item>")
    .concat(splitItems(xml, "<item ", "</item>"));

  const items: RSSItem[] = itemXmls.map((itemXml) => ({
    title: extractTag(itemXml, "title"),
    link:
      extractTag(itemXml, "link") ||
      extractTag(itemXml, "feedburner:origLink") ||
      "",
    description:
      extractTag(itemXml, "description") ||
      extractTag(itemXml, "summary") ||
      "",
    pubDate:
      extractTag(itemXml, "pubDate") ||
      extractTag(itemXml, "dc:date") ||
      "",
    categories: extractAllTags(itemXml, "category"),
    contentEncoded: extractTag(itemXml, "content:encoded"),
    creator:
      extractTag(itemXml, "dc:creator") ||
      extractTag(itemXml, "author") ||
      "",
    guid:
      extractTag(itemXml, "guid") ||
      extractTag(itemXml, "link") ||
      "",
  }));

  return { title, link, description, items };
}

function parseAtom(xml: string): RSSFeed {
  const title = extractTag(xml, "title");
  const link = extractAttr(xml, "link", "href") || extractTag(xml, "link");
  const description = extractTag(xml, "subtitle") || "";

  const entryXmls = splitItems(xml, "<entry>", "</entry>")
    .concat(splitItems(xml, "<entry ", "</entry>"));

  const items: RSSItem[] = entryXmls.map((entryXml) => ({
    title: extractTag(entryXml, "title"),
    link:
      extractAttr(entryXml, "link", "href") ||
      extractTag(entryXml, "link") ||
      "",
    description:
      extractTag(entryXml, "summary") ||
      extractTag(entryXml, "content") ||
      "",
    pubDate:
      extractTag(entryXml, "published") ||
      extractTag(entryXml, "updated") ||
      "",
    categories: extractAllTags(entryXml, "category"),
    contentEncoded: extractTag(entryXml, "content"),
    creator: extractTag(entryXml, "author"),
    guid: extractTag(entryXml, "id") || "",
  }));

  return { title, link, description, items };
}

/**
 * Strip HTML tags, returning plain text
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
