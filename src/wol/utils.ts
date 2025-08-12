import * as cheerio from "cheerio";
import wolLanguages from "./wol_languages.json";
import {
  Document,
  SearchOptions,
  SearchResponse,
  SearchResult,
  WOLEndpoints,
  WOLError,
} from "./types";

export const WOL_ENDPOINTS: WOLEndpoints = {
  SEARCH: "https://wol.jw.org/{lang}/wol/s/{rev}/lp-{lp}",
  DOCUMENT: "https://wol.jw.org/{lang}/wol/d/{rev}/lp-{lp}/{docId}",
  LIBRARY: "https://wol.jw.org/{lang}/wol/li/{rev}/lp-{lp}",
  HOME: "https://wol.jw.org/{lang}/wol/h/{rev}/lp-{lp}",
};

function normalizeIsoLanguageCode(language: string | undefined): string {
  const input = (language || "en").toLowerCase();
  const primary = input.split(/[\-_]/)[0];
  return primary || "en";
}

function resolveWolConfig(language: string | undefined): {
  lp: string;
  rev: string;
} {
  const norm = normalizeIsoLanguageCode(language);
  const mapping = (wolLanguages as any).mapping as Record<string, any>;
  const entry = mapping ? mapping[norm] : undefined;
  const lp: string = (entry && entry.lp) || (norm === "en" ? "e" : norm);
  const rev: string = (entry && entry.rsconf) || "r1";
  return { lp, rev };
}

export class URLBuilder {
  static buildSearchURL(query: string, options: SearchOptions = {}): string {
    const {
      scope = "par",
      publications = [],
      language = "en",
      sort = "occ",
      page = 1,
    } = options;

    const { lp, rev } = resolveWolConfig(language);
    let baseUrl = WOL_ENDPOINTS.SEARCH.replace("{lang}", language)
      .replace("{rev}", rev)
      .replace("{lp}", lp);
    const params = new URLSearchParams();

    // Add search query
    params.append("q", query);
    params.append("p", scope);
    // Map sort to WOL values
    const sortParam =
      sort === "newest" ? "newest" : sort === "oldest" ? "oldest" : "occ";
    params.append("r", sortParam);
    params.append("st", "a");

    // Add publication filters
    publications.forEach((pub) => {
      params.append("fc[]", pub);
    });

    // Add pagination
    if (page > 1) {
      params.append("pg", page.toString());
    }

    return `${baseUrl}?${params.toString()}`;
  }

  static buildDocumentURL(documentId: string, language: string = "en"): string {
    const { lp, rev } = resolveWolConfig(language);
    return WOL_ENDPOINTS.DOCUMENT.replace("{lang}", language)
      .replace("{rev}", rev)
      .replace("{lp}", lp)
      .replace("{docId}", documentId);
  }

  static validateAndNormalizeDocumentURL(urlString: string): string {
    let parsed: URL;
    try {
      parsed = new URL(urlString);
    } catch {
      throw new Error("Invalid URL");
    }
    const host = parsed.hostname.toLowerCase();
    if (!(host.endsWith("jw.org") && host.includes("wol"))) {
      throw new Error("URL must be a jw.org WOL document");
    }
    if (!/\/wol\/d\//i.test(parsed.pathname)) {
      throw new Error("URL must point to a WOL document (contains /wol/d/)");
    }
    const allowed = new Set(["q", "p"]);
    const clean = new URLSearchParams();
    parsed.searchParams.forEach((v, k) => {
      if (allowed.has(k)) clean.append(k, v);
    });
    parsed.search = clean.toString() ? `?${clean.toString()}` : "";
    return parsed.toString();
  }
}

export class SearchOperatorParser {
  // Convert WOL search operators to URL-safe format
  static encodeOperators(query: string): string {
    return query
      .replace(/&/g, "%26")
      .replace(/\+/g, "%2B")
      .replace(/\|/g, "%7C")
      .replace(/\//g, "%2F")
      .replace(/\^/g, "%5E")
      .replace(/%/g, "%25")
      .replace(/!/g, "%21")
      .replace(/"/g, "%22")
      .replace(/\*/g, "%2A")
      .replace(/\?/g, "%3F")
      .replace(/#/g, "%23")
      .replace(/\\/g, "%5C")
      .replace(/\(/g, "%28")
      .replace(/\)/g, "%29");
  }

  // Validate search operators syntax
  static validateOperators(query: string): boolean {
    // Allow unicode letters/numbers so non-English queries pass validation
    const validOperators = /^[\p{L}\p{N}\s&+|\/\^%!"\*\?#\\()_-]+$/u;
    return validOperators.test(query);
  }

  // Parse complex search queries
}

export class ContentParser {
  static parseSearchResults(html: string): SearchResponse {
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];

    // Key publications
    $("ul.resultContentTopic").each((_, ul) => {
      const $ul = $(ul);
      const $captionLink = $ul.find("li.caption a").first();
      if ($captionLink.length === 0) return;
      const href = $captionLink.attr("href") || "";
      const url = href.startsWith("http") ? href : `https://wol.jw.org${href}`;
      const title = ($captionLink.text() || "").trim();

      const publication = (
        $ul.find("li.ref").first().text() || "Key Publication"
      ).trim();
      const subheadings: string[] = [];
      $ul.find("li.resultSubheadings ul a").each((__, a) => {
        const t = ($(a).text() || "").trim();
        if (t) subheadings.push(t);
      });

      const docIdMatch = url.match(/\/d\/r\d\/lp-[a-z0-9-]+\/(\d+)/i);
      const documentId = docIdMatch ? docIdMatch[1] : undefined;

      results.push({
        title,
        url,
        snippet: `Key publication about ${title}`,
        publication,
        documentId,
        resultType: "key_publication",
        subheadings: subheadings.length ? subheadings : undefined,
      });
    });

    // Document results
    $("ul.resultContentDocument").each((_, ul) => {
      const $ul = $(ul);
      const $caption = $ul.find("li.caption").first();
      const $link = $caption.find("a").first();
      if ($link.length === 0) return;
      const href = $link.attr("href") || "";
      const url = href.startsWith("http") ? href : `https://wol.jw.org${href}`;
      const title = ($link.text() || "").trim();

      const countText = ($caption.find("span.count").text() || "").trim();
      const occMatch = countText.match(/([\d][\d.,]*)/);
      const occurrences = occMatch
        ? parseInt(occMatch[1].replace(/[.,]/g, ""), 10)
        : undefined;

      const publication = (
        $ul.find("li.ref").first().text() || "JW Publication"
      ).trim();

      const contextSnippets: string[] = [];
      $ul.find("div.document p").each((__, p) => {
        const txt = ($(p).text() || "").trim();
        if (txt && txt.length > 10)
          contextSnippets.push(
            txt.substring(0, 150) + (txt.length > 150 ? "..." : "")
          );
      });

      results.push({
        title,
        url,
        snippet: contextSnippets[0] || `Document in ${publication}`,
        publication,
        occurrences,
        resultType: "document_result",
        contextSnippets: contextSnippets.length ? contextSnippets : undefined,
      });
    });

    // Pagination and total
    const countContainer = $("#resultsCount").first().text();
    const totalMatch = countContainer.match(/([\d][\d.,]*)/);
    const totalResults = totalMatch
      ? parseInt(totalMatch[1].replace(/[.,]/g, ""), 10)
      : 0;

    const pageSize = 40;
    const totalPages =
      totalResults > 0 ? Math.ceil(totalResults / pageSize) : 1;
    // Current page: selected navigation or default 1
    let currentPage = 1;
    const selected = $(".resultsNavigationSelected .navContent").first().text();
    if (selected && /\d+/.test(selected)) currentPage = parseInt(selected, 10);

    return {
      results,
      pagination: { totalResults, pageSize, totalPages, currentPage },
    };
  }

  static parseDocument(html: string, documentUrl: string): Document {
    try {
      const $ = cheerio.load(html);

      // Title
      const rawTitle = $("title").first().text() || "";
      const title = rawTitle.trim() || "Untitled Document";

      // Select a sensible content root
      const selectRoot = (): cheerio.Cheerio<any> => {
        const candidates = [
          "article#article",
          "article.article",
          "div.article",
          "#content",
          "main",
          "body",
        ];
        for (const sel of candidates) {
          const node = $(sel).first();
          if (node && node.length > 0 && node.children().length > 0)
            return node;
        }
        return $("body");
      };
      const $root = selectRoot();

      // Normalize href/src to absolute
      const origin = new URL(documentUrl).origin;
      $root.find("a[href]").each((_: number, el: any) => {
        const $el = $(el);
        const href = $el.attr("href");
        if (!href) return;
        if (href.startsWith("/")) $el.attr("href", `${origin}${href}`);
      });
      // Unwrap Bible citation links (/wol/bc...) to plain text (same across languages)
      $root.find('a[href*="/wol/bc"]').each((_: number, el: any) => {
        const $el = $(el);
        const text = ($el.text() || "").trim();
        $el.replaceWith(text);
      });
      $root.find("img").each((_: number, el: any) => {
        const $img = $(el);
        const src = $img.attr("src");
        const dataSrc = $img.attr("data-src");
        const small = $img.attr("data-img-small-src");
        const chosen = src || dataSrc || small;
        if (!chosen) return;
        const absolute = chosen.startsWith("/") ? `${origin}${chosen}` : chosen;
        $img.attr("src", absolute);
      });

      const contentHTML = ($root.html() || "").trim();

      // Publication and article names via navigation bar if available
      let publication = "Unknown Publication";
      const $navTitle = $("#resultNavigation .resultNavTitle ul").first();
      if ($navTitle && $navTitle.length > 0) {
        const articleName = $navTitle
          .find("li.resultsNavigationSelected .navContent")
          .first()
          .text()
          .trim();
        const pubName = $navTitle
          .find("li.resultDocumentPubTitle .navContent")
          .first()
          .text()
          .trim();
        if (pubName) publication = pubName;
        if (!publication) {
          // fallback breadcrumbs
          const $crumb = $(
            "ul.breadcrumbs, nav.breadcrumbs, .breadcrumbs"
          ).first();
          if ($crumb && $crumb.length > 0) {
            const txt = $crumb.text().trim();
            if (txt)
              publication = txt
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean)
                .join(" / ");
          }
        }
        // Note: we show the full article content below; the navigation bar's article
        // title is informative but we keep the <title> text as the document title to avoid surprises.
      } else {
        const $crumb = $(
          "ul.breadcrumbs, nav.breadcrumbs, .breadcrumbs"
        ).first();
        if ($crumb && $crumb.length > 0) {
          const txt = $crumb.text().trim();
          if (txt)
            publication = txt
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean)
              .join(" / ");
        }
      }

      // Subheadings
      const subheadings: Array<{ title: string; url: string }> = [];
      $("#subheadings ul.documentNavigation li.subheading a").each(
        (_: number, el: any) => {
          const $a = $(el);
          const t = ($a.text() || "").trim();
          const href = $a.attr("href") || "";
          if (t && href)
            subheadings.push({
              title: t,
              url: href.startsWith("/") ? `${origin}${href}` : href,
            });
        }
      );

      // Similar material
      const similarMaterials: Array<{
        title: string;
        subtitle?: string;
        url: string;
      }> = [];
      $("#similarMaterial ul.results li.simDoc a").each(
        (_: number, el: any) => {
          const $a = $(el);
          const href = $a.attr("href") || "";
          const url = href
            ? href.startsWith("/")
              ? `${origin}${href}`
              : href
            : "";
          const title = (
            $a.find(".cardTitleBlock .cardLine1").first().text() || ""
          ).trim();
          const subtitle =
            (
              $a.find(".cardTitleBlock .cardLine2").first().text() || ""
            ).trim() || undefined;
          if (url && title) similarMaterials.push({ title, subtitle, url });
        }
      );

      // Metadata best effort
      const metadata: any = {};
      const metaDate = $(
        'meta[name="date"], meta[property="article:published_time"], meta[name="DC.Date"]'
      )
        .first()
        .attr("content");
      const timeEl = $root.find("time").first();
      const timeVal = timeEl.attr("datetime") || timeEl.text();
      if (metaDate && metaDate.trim()) metadata.date = metaDate.trim();
      else if (timeVal && timeVal.trim()) metadata.date = timeVal.trim();

      // Language
      let language = ($("html").attr("lang") || "").toLowerCase();
      if (!language) {
        const u = new URL(documentUrl);
        const seg = (u.pathname.split("/")[1] || "").toLowerCase();
        if (seg) language = seg;
      }
      if (!language) language = "en";

      // Document id from URL path (last numeric segment)
      const u = new URL(documentUrl);
      const parts = u.pathname.split("/").filter(Boolean);
      const isDigits = (s: string) =>
        s.length > 0 && Array.from(s).every((c) => c >= "0" && c <= "9");
      let documentId = "";
      for (let i = parts.length - 1; i >= 0; i--) {
        if (isDigits(parts[i])) {
          documentId = parts[i];
          break;
        }
      }

      return {
        id: documentId,
        title,
        content: contentHTML,
        publication,
        url: "",
        language,
        metadata,
        subheadings: subheadings.length ? subheadings : undefined,
        similarMaterials: similarMaterials.length
          ? similarMaterials
          : undefined,
      };
    } catch (error) {
      throw new Error(`Failed to parse document: ${error}`);
    }
  }
}

export function createWOLError(
  code: WOLError["code"],
  message: string,
  details?: any
): WOLError {
  const error = new Error(message) as WOLError;
  error.code = code;
  error.details = details;
  return error;
}
