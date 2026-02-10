import * as cheerio from "cheerio";
import {
	type SearchOptions,
	type Document,
	type Publication,
	type PublicationType,
	type WOLError,
	PUBLICATION_NAMES,
	type SearchResponse,
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
		options: SearchOptions = {},
	): Promise<SearchResponse> {
		try {
			if (
				!SearchOperatorParser.validateOperators(query) &&
				options.useOperators === true
			) {
				throw createWOLError(
					"INVALID_QUERY",
					"Invalid characters or operators in query",
					{ query },
				);
			}

			const searchUrl = URLBuilder.buildSearchURL(query, options);

			console.log("searchUrl", searchUrl, query);

			const response = await WOLService.fetchWithRetry(searchUrl);
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
					{ status: response.status },
				);
			}

			const parsed = ContentParser.parseSearchResults(html);

			// Separate key publications and document results
			const keyPublications = parsed.results.filter(
				(r) => r.resultType === "key_publication",
			);
			const documentResults = parsed.results.filter(
				(r) => r.resultType === "document_result",
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
		format: string = "markdown",
	): Promise<Document> {
		try {
			const documentUrl = URLBuilder.validateAndNormalizeDocumentURL(url);

			const response = await WOLService.fetchWithRetry(documentUrl);

			if (response.status === 404) {
				throw createWOLError("NOT_FOUND", `Document not found`, {
					url: documentUrl,
				});
			}

			if (response.status === 502 || response.status === 503) {
				throw createWOLError(
					"SERVICE_UNAVAILABLE",
					"WOL service temporarily unavailable",
					{ status: response.status },
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
				document.content = WOLService.convertToMarkdown(document.content);
			} else if (format === "plain") {
				document.content = WOLService.convertToPlainText(document.content);
			}

			return document;
		} catch (error) {
			if (error instanceof Error && (error as WOLError).code) {
				throw error;
			}

			throw createWOLError(
				"NETWORK_ERROR",
				`Document retrieval failed: ${error}`,
				{ url },
			);
		}
	}

	static async browsePublications(
		type?: PublicationType,
		language: string = "en",
		year?: number,
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
				{ type, language, year },
			);
		}
	}

	private static async fetchWithRetry(
		url: string,
		retries: number = WOLService.MAX_RETRIES,
	): Promise<Response> {
		for (let i = 0; i < retries; i++) {
			try {
				const controller = new AbortController();
				const timeoutId = setTimeout(
					() => controller.abort(),
					WOLService.TIMEOUT,
				);

				const response = await fetch(url, {
					signal: controller.signal,
					headers: {
						"User-Agent": "Mozilla/5.0 (compatible; WOL-MCP-Server/1.0)",
						Accept:
							"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
						// Prefer language from the URL path (e.g., /pt/), fallback to English
						"Accept-Language": (() => {
							try {
								const m = url.match(/https?:\/\/[^/]+\/([a-z-]+)\//i);
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
				await new Promise((resolve) => setTimeout(resolve, 2 ** i * 1000));
			}
		}

		throw new Error("Max retries exceeded");
	}

	private static convertToMarkdown(html: string): string {
		const $ = cheerio.load(html, { xml: false });

		const skipTags = new Set([
			"script",
			"style",
			"noscript",
			"input",
			"button",
			"textarea",
			"select",
			"fieldset",
			"svg",
		]);

		const convertNode = (node: any): string => {
			if (node.type === "text") {
				return (node.data || "").replace(/\s+/g, " ");
			}
			if (node.type !== "tag" && node.type !== "root") return "";

			const tag = (node.name || "").toLowerCase();
			if (skipTags.has(tag)) return "";

			const children = (node.children || [])
				.map((c: any) => convertNode(c))
				.join("");

			switch (tag) {
				case "h1":
				case "h2":
				case "h3":
				case "h4":
				case "h5":
				case "h6": {
					const level = parseInt(tag[1]);
					const hashes = "#".repeat(level);
					return `\n\n${hashes} ${children.trim()}\n\n`;
				}
				case "p":
					return `${children.trim()}\n\n`;
				case "strong":
				case "b": {
					const t = children.trim();
					return t ? `**${t}**` : "";
				}
				case "em":
				case "i": {
					const t = children.trim();
					return t ? `*${t}*` : "";
				}
				case "a": {
					const href = node.attribs?.href || "";
					const text = children.trim();
					return href && text ? `[${text}](${href})` : text;
				}
				case "img": {
					const src = node.attribs?.src || "";
					const alt = node.attribs?.alt || "";
					return src ? `![${alt}](${src})` : "";
				}
				case "br":
					return "\n";
				case "hr":
					return "\n\n---\n\n";
				case "ul": {
					const items = (node.children || [])
						.filter((c: any) => c.type === "tag" && c.name === "li")
						.map((li: any) => `- ${convertNode(li).trim()}`)
						.join("\n");
					return `\n${items}\n\n`;
				}
				case "ol": {
					const start = parseInt(node.attribs?.start || "1") || 1;
					const items = (node.children || [])
						.filter((c: any) => c.type === "tag" && c.name === "li")
						.map(
							(li: any, i: number) => `${start + i}. ${convertNode(li).trim()}`,
						)
						.join("\n");
					return `\n${items}\n\n`;
				}
				case "li":
					return children;
				case "blockquote": {
					const lines = children
						.trim()
						.split("\n")
						.map((l: string) => `> ${l}`)
						.join("\n");
					return `\n${lines}\n\n`;
				}
				case "figure":
					return `\n${children.trim()}\n\n`;
				case "figcaption":
					return `*${children.trim()}*\n`;
				case "table": {
					const rows: string[][] = [];
					$(node)
						.find("tr")
						.each((_: number, tr: any) => {
							const cells: string[] = [];
							$(tr)
								.find("td, th")
								.each((__: number, cell: any) => {
									cells.push(convertNode(cell).trim());
								});
							rows.push(cells);
						});
					if (rows.length === 0) return children;
					const colCount = Math.max(...rows.map((r) => r.length));
					const lines: string[] = [];
					for (let i = 0; i < rows.length; i++) {
						const padded = rows[i].concat(
							Array(colCount - rows[i].length).fill(""),
						);
						lines.push(`| ${padded.join(" | ")} |`);
						if (i === 0) {
							lines.push(`| ${Array(colCount).fill("---").join(" | ")} |`);
						}
					}
					return `\n${lines.join("\n")}\n\n`;
				}
				case "div":
				case "section":
				case "article":
				case "header":
				case "footer":
				case "main":
				case "aside":
				case "nav":
					return `\n${children}\n`;
				default:
					return children;
			}
		};

		const root = $.root()[0];
		let result = convertNode(root);

		// Collapse excessive newlines and trim
		result = result.replace(/\n{3,}/g, "\n\n").trim();

		// Fallback: if conversion produced empty/very short output, extract text
		if (result.length < 20) {
			const $article = $("article#article");
			const $fallback = $article.length > 0 ? $article : $("body");
			const fallbackText = $fallback.text();
			result = fallbackText
				.replace(/[\t ]*\n[\t ]*(\n[\t ]*)*/g, "\n\n")
				.trim();
		}

		return result;
	}

	private static convertToPlainText(html: string): string {
		const $ = cheerio.load(html);
		$("script, style, noscript").remove();
		const text = $.root().text();
		return text.replace(/\s+/g, " ").trim();
	}
}
