import {
  SearchOptions,
  Document,
  Publication,
  PublicationType,
  WOLError,
  PUBLICATION_NAMES,
  SearchResponse,
} from "./types";
import {
  URLBuilder,
  SearchOperatorParser,
  ContentParser,
  createWOLError,
} from "./utils";

export class WOLService {
  private static readonly MAX_RETRIES = 3;
  private static readonly TIMEOUT = 30000; // 30 seconds

  static async search(
    query: string,
    options: SearchOptions = {}
  ): Promise<SearchResponse> {
    try {
      if (
        !SearchOperatorParser.validateOperators(query) &&
        options.useOperators === true
      ) {
        throw createWOLError(
          "INVALID_QUERY",
          "Invalid characters or operators in query",
          { query }
        );
      }

      const searchUrl = URLBuilder.buildSearchURL(query, options);

      console.log("searchUrl", searchUrl, query);

      const response = await this.fetchWithRetry(searchUrl);
      const html = await response.text();

      if (response.status === 404) {
        return {
          results: [],
          pagination: {
            totalResults: 0,
            pageSize: 40,
            totalPages: 1,
            currentPage: options.page ?? 1,
          },
        };
      }

      if (response.status === 502 || response.status === 503) {
        throw createWOLError(
          "SERVICE_UNAVAILABLE",
          "WOL service temporarily unavailable",
          { status: response.status }
        );
      }

      const parsed = ContentParser.parseSearchResults(html);

      // Separate key publications and document results
      const keyPublications = parsed.results.filter(
        (r) => r.resultType === "key_publication"
      );
      const documentResults = parsed.results.filter(
        (r) => r.resultType === "document_result"
      );

      // Apply limit only to document results
      const limitedDocuments = options.limit
        ? documentResults.slice(0, options.limit)
        : documentResults;

      return {
        results: [...keyPublications, ...limitedDocuments],
        pagination: parsed.pagination,
      };
    } catch (error) {
      if (error instanceof Error && (error as WOLError).code) {
        throw error;
      }

      throw createWOLError("NETWORK_ERROR", `Search failed: ${error}`, {
        query,
        options,
      });
    }
  }

  static async getDocumentByUrl(
    url: string,
    format: string = "markdown"
  ): Promise<Document> {
    try {
      const documentUrl = URLBuilder.validateAndNormalizeDocumentURL(url);

      const response = await this.fetchWithRetry(documentUrl);

      if (response.status === 404) {
        throw createWOLError("NOT_FOUND", `Document not found`, {
          url: documentUrl,
        });
      }

      if (response.status === 502 || response.status === 503) {
        throw createWOLError(
          "SERVICE_UNAVAILABLE",
          "WOL service temporarily unavailable",
          { status: response.status }
        );
      }

      const html = await response.text();
      const document = ContentParser.parseDocument(html, documentUrl);
      document.url = documentUrl;

      // Normalize non-breaking spaces in the raw HTML/content before formatting
      // Handles both HTML entity and Unicode NBSP
      document.content = document.content
        .replace(/&nbsp;/gi, " ")
        .replace(/\u00A0/g, " ");

      // Format content based on requested format
      if (format === "markdown") {
        document.content = this.convertToMarkdown(document.content);
      } else if (format === "plain") {
        document.content = this.convertToPlainText(document.content);
      }

      return document;
    } catch (error) {
      if (error instanceof Error && (error as WOLError).code) {
        throw error;
      }

      throw createWOLError(
        "NETWORK_ERROR",
        `Document retrieval failed: ${error}`,
        { url }
      );
    }
  }

  static async browsePublications(
    type?: PublicationType,
    language: string = "en",
    year?: number
  ): Promise<Publication[]> {
    try {
      const publications: Publication[] = [];

      if (type) {
        publications.push({
          code: type,
          name: PUBLICATION_NAMES[type],
          description: `Browse ${PUBLICATION_NAMES[type]} publications`,
          language,
          years: year ? [year] : undefined,
        });
      } else {
        // Return all available publication types
        Object.entries(PUBLICATION_NAMES).forEach(([code, name]) => {
          publications.push({
            code: code as PublicationType,
            name,
            description: `Browse ${name} publications`,
            language,
          });
        });
      }

      return publications;
    } catch (error) {
      throw createWOLError(
        "NETWORK_ERROR",
        `Publication browsing failed: ${error}`,
        { type, language, year }
      );
    }
  }

  private static async fetchWithRetry(
    url: string,
    retries: number = this.MAX_RETRIES
  ): Promise<Response> {
    for (let i = 0; i < retries; i++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT);

        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; WOL-MCP-Server/1.0)",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            // Prefer language from the URL path (e.g., /pt/), fallback to English
            "Accept-Language": (() => {
              try {
                const m = url.match(/https?:\/\/[^\/]+\/([a-z-]+)\//i);
                return m
                  ? `${m[1]},${m[1]}-US;q=0.9,en-US,en;q=0.5`
                  : "en-US,en;q=0.5";
              } catch {
                return "en-US,en;q=0.5";
              }
            })(),
            "Accept-Encoding": "gzip, deflate",
            Connection: "keep-alive",
            "Upgrade-Insecure-Requests": "1",
          },
        });

        clearTimeout(timeoutId);
        return response;
      } catch (error) {
        console.warn(`Fetch attempt ${i + 1} failed:`, error);

        if (i === retries - 1) {
          throw error;
        }

        // Exponential backoff
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, i) * 1000)
        );
      }
    }

    throw new Error("Max retries exceeded");
  }

  private static convertToMarkdown(html: string): string {
    return (
      html
        // Ensure images render with alt text when present - explicitly extract src and alt
        .replace(/<img[^>]*>/gi, (imgTag) => {
          const srcMatch = imgTag.match(/\bsrc=["']([^"']+)["']/i);
          const altMatch = imgTag.match(/\balt=["']([^"']*)["']/i);

          if (srcMatch) {
            const src = srcMatch[1];
            const alt = altMatch ? altMatch[1] : "";
            return `![${alt}](${src})`;
          }
          return imgTag; // fallback if no src found
        })
        .replace(
          /<h([1-6])[^>]*>(.*?)<\/h[1-6]>/gi,
          (match, level, content) => {
            const hashes = "#".repeat(parseInt(level));
            return `${hashes} ${content}\n\n`;
          }
        )
        .replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n\n")
        .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**")
        .replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*")
        .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)")
        .replace(/<br[^>]*\/?>/gi, "\n")
        .replace(/<[^>]*>/g, "")
        .replace(/\n\n\n+/g, "\n\n")
        .trim()
    );
  }

  private static convertToPlainText(html: string): string {
    return html
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }
}
