import * as cheerio from "cheerio";
import wolLanguages from "./wol_languages.json";
import type {
	BibleFootnote,
	BibleIndex,
	BibleMedia,
	BibleStudyNote,
	BibleTextResult,
	BibleVerse,
} from "./types";
import { BIBLE_BOOKS } from "./types";
import { createWOLError } from "./utils";

const WOL_BASE_URL = "https://wol.jw.org";

function normalizeIsoLanguageCode(language: string | undefined): string {
	const input = (language || "en").toLowerCase();
	const primary = input.split(/[-_]/)[0];
	return primary || "en";
}

function resolveWolConfig(language: string | undefined): {
	lp: string;
	rev: string;
	lang: string;
} {
	const norm = normalizeIsoLanguageCode(language);
	const mapping = (wolLanguages as Record<string, unknown>).mapping as Record<
		string,
		{ lp?: string; rsconf?: string }
	>;
	const entry = mapping ? mapping[norm] : undefined;
	const lp: string = (entry && entry.lp) || (norm === "en" ? "e" : norm);
	const rev: string = (entry && entry.rsconf) || "r1";
	return { lp, rev, lang: norm };
}

// Regex to split "Publication Name, pp. 123" into publication and detail.
// Detail starts with: p./pp., article(s), lesson(s), section(s), chap.(s), or Portuguese equivalents.
const DETAIL_RE =
	/^(.*?)\s*,?\s*\b(pp?\.\s|articles?\s|lessons?\s|sections?\s|chaps?\.\s|artigos?\s|li[çc][ãa]o\s|li[çc][õo]es\s|se[çc][ãa]o\s|se[çc][õo]es\s)/i;

function splitPubDetail(text: string): { pubName: string; detail: string } {
	const m = text.match(DETAIL_RE);
	if (m) {
		const pubName = m[1].trim().replace(/,+$/, "");
		const detailStart = m[0].length - m[2].length;
		const detail = text.substring(detailStart).trim().replace(/,+$/, "");
		return { pubName, detail };
	}
	return { pubName: text.trim().replace(/,+$/, ""), detail: "" };
}

export class BibleService {
	private static readonly REQUEST_TIMEOUT = 30000;
	private static readonly MAX_RETRIES = 3;

	static async fetchWithRetry(
		url: string,
		retries = BibleService.MAX_RETRIES,
	): Promise<Response> {
		let lastError: Error | null = null;

		for (let attempt = 0; attempt < retries; attempt++) {
			try {
				const controller = new AbortController();
				const timeoutId = setTimeout(
					() => controller.abort(),
					BibleService.REQUEST_TIMEOUT,
				);

				const response = await fetch(url, {
					headers: {
						"User-Agent":
							"Mozilla/5.0 (compatible; WOL-MCP/1.0; +https://github.com/LeomaiaJr/wol-mcp-server)",
						Accept: "text/html,application/xhtml+xml",
						"Accept-Language": "en-US,en;q=0.9",
					},
					signal: controller.signal,
				});

				clearTimeout(timeoutId);

				if (!response.ok) {
					if (response.status === 404) {
						throw createWOLError(
							"NOT_FOUND",
							`Bible content not found at ${url}`,
						);
					}
					throw new Error(`HTTP ${response.status}`);
				}

				return response;
			} catch (error) {
				lastError = error as Error;
				if (
					(error as { code?: string }).code === "NOT_FOUND" ||
					attempt === retries - 1
				) {
					throw error;
				}
				// Exponential backoff
				await new Promise((resolve) =>
					setTimeout(resolve, 2 ** attempt * 1000),
				);
			}
		}

		throw (
			lastError ||
			createWOLError("NETWORK_ERROR", "Failed to fetch Bible content")
		);
	}

	static buildBibleUrl(
		book: number,
		chapter: number,
		language: string,
		verseStart?: number,
		verseEnd?: number,
	): string {
		const { lp, rev, lang } = resolveWolConfig(language);
		let url = `${WOL_BASE_URL}/${lang}/wol/b/${rev}/lp-${lp}/nwtsty/${book}/${chapter}`;

		// Add verse hash if specified
		if (verseStart) {
			const verseHash = verseEnd
				? `#v=${book}:${chapter}:${verseStart}-${book}:${chapter}:${verseEnd}`
				: `#v=${book}:${chapter}:${verseStart}`;
			url += verseHash;
		}

		return url;
	}

	private static buildIndexUrl(book: number, language: string): string {
		const { lp, rev, lang } = resolveWolConfig(language);
		const docId = book <= 39 ? 1204389 + book : 1204390 + book;
		return `${WOL_BASE_URL}/${lang}/wol/d/${rev}/lp-${lp}/${docId}`;
	}

	static async getBibleText(options: {
		book: number;
		chapter: number;
		verseStart?: number;
		verseEnd?: number;
		language?: string;
		includeStudyNotes?: boolean;
		includeCrossReferences?: boolean;
		includeMedia?: boolean;
		includeIndexes?: boolean;
	}): Promise<BibleTextResult> {
		const {
			book,
			chapter,
			verseStart,
			verseEnd,
			language = "en",
			includeStudyNotes = true,
			includeCrossReferences = true,
			includeMedia = true,
			includeIndexes = true,
		} = options;

		// Validate book number
		const bookInfo = BIBLE_BOOKS[book];
		if (!bookInfo) {
			throw createWOLError(
				"INVALID_QUERY",
				`Invalid book number: ${book}. Must be 1-66.`,
			);
		}

		// Validate chapter number
		if (chapter < 1 || chapter > bookInfo.chapters) {
			throw createWOLError(
				"INVALID_QUERY",
				`Invalid chapter ${chapter} for ${bookInfo.name}. Must be 1-${bookInfo.chapters}.`,
			);
		}

		const url = BibleService.buildBibleUrl(book, chapter, language);

		// Fetch Bible text and Index page in parallel
		const [response, indexHtml] = await Promise.all([
			BibleService.fetchWithRetry(url),
			includeIndexes
				? BibleService.fetchWithRetry(
						BibleService.buildIndexUrl(book, language),
					)
						.then((r) => r.text())
						.catch(() => null)
				: Promise.resolve(null),
		]);
		const html = await response.text();

		const result = BibleService.parseBibleContent(html, {
			book,
			chapter,
			verseStart,
			verseEnd,
			language,
			url,
			includeStudyNotes,
			includeCrossReferences,
			includeMedia,
		});

		// Merge index data from the Index to Bible Publications page
		if (includeIndexes && indexHtml) {
			const indexMap = BibleService.parseIndexPage(
				indexHtml,
				book,
				chapter,
				verseStart,
				verseEnd,
			);
			for (const verse of result.verses) {
				const indexes = indexMap.get(verse.number);
				if (indexes && indexes.length > 0) {
					verse.indexes = indexes;
				}
			}
		}

		return result;
	}

	private static parseBibleContent(
		html: string,
		options: {
			book: number;
			chapter: number;
			verseStart?: number;
			verseEnd?: number;
			language: string;
			url: string;
			includeStudyNotes: boolean;
			includeCrossReferences: boolean;
			includeMedia: boolean;
		},
	): BibleTextResult {
		const $ = cheerio.load(html);
		const {
			book,
			chapter,
			verseStart,
			verseEnd,
			language,
			url,
			includeStudyNotes,
			includeCrossReferences,
			includeMedia,
		} = options;

		const bookInfo = BIBLE_BOOKS[book];
		const verses: BibleVerse[] = [];

		// Parse verses from the main content
		$("span.v").each((_, element) => {
			const $verse = $(element);
			const verseId = $verse.attr("id") || "";

			// Extract verse number from ID (format: v{book}-{chapter}-{verse}-{part})
			const idMatch = verseId.match(/v\d+-\d+-(\d+)/);
			if (!idMatch) return;

			const verseNum = parseInt(idMatch[1], 10);

			// Filter by verse range if specified
			if (verseStart && verseNum < verseStart) return;
			if (verseEnd && verseNum > verseEnd) return;

			// Get verse text (clean it up)
			let verseText = $verse.text().trim();
			// Remove verse number from start if present
			verseText = verseText.replace(/^\d+\s*/, "");
			// Normalize whitespace
			verseText = verseText.replace(/\s+/g, " ").trim();
			// Remove non-breaking spaces
			verseText = verseText.replace(/\u00A0/g, " ");

			// Parse footnotes within this verse
			const footnotes: BibleFootnote[] = [];
			$verse.find('a.fn, a[href*="/wol/fn/"]').each((_, fn) => {
				const $fn = $(fn);
				const marker = $fn.text().trim();
				if (marker) {
					footnotes.push({ marker, text: "" });
				}
			});

			const verse: BibleVerse = {
				number: verseNum,
				text: verseText,
			};

			if (footnotes.length > 0) {
				verse.footnotes = footnotes;
			}

			verses.push(verse);
		});

		// Sort verses by number and remove duplicates
		const uniqueVerses = new Map<number, BibleVerse>();
		for (const verse of verses) {
			if (!uniqueVerses.has(verse.number)) {
				uniqueVerses.set(verse.number, verse);
			}
		}
		const sortedVerses = Array.from(uniqueVerses.values()).sort(
			(a, b) => a.number - b.number,
		);

		// Parse study content from the study panel
		if (includeStudyNotes || includeCrossReferences || includeMedia) {
			BibleService.parseStudyContent($, sortedVerses, book, chapter, {
				includeStudyNotes,
				includeCrossReferences,
				includeMedia,
			});
		}

		// Generate reference string
		const actualStart =
			sortedVerses.length > 0 ? sortedVerses[0].number : verseStart || 1;
		const actualEnd =
			sortedVerses.length > 0
				? sortedVerses[sortedVerses.length - 1].number
				: verseEnd || actualStart;
		const reference =
			actualStart === actualEnd
				? `${bookInfo.name} ${chapter}:${actualStart}`
				: `${bookInfo.name} ${chapter}:${actualStart}-${actualEnd}`;

		// Build final URL with verse range
		let finalUrl = url;
		if (verseStart || verseEnd) {
			const hashStart = verseStart || 1;
			const hashEnd = verseEnd || actualEnd;
			finalUrl = `${url.split("#")[0]}#v=${book}:${chapter}:${hashStart}-${book}:${chapter}:${hashEnd}`;
		}

		return {
			reference,
			book: {
				number: book,
				name: bookInfo.name,
			},
			chapter,
			verses: sortedVerses,
			url: finalUrl,
			language,
		};
	}

	private static parseStudyContent(
		$: cheerio.CheerioAPI,
		verses: BibleVerse[],
		book: number,
		chapter: number,
		options: {
			includeStudyNotes: boolean;
			includeCrossReferences: boolean;
			includeMedia: boolean;
		},
	): void {
		const { includeStudyNotes, includeCrossReferences, includeMedia } = options;

		// Create a map of verses by number for quick lookup
		const verseMap = new Map<number, BibleVerse>();
		for (const verse of verses) {
			verseMap.set(verse.number, verse);
		}

		// Parse study discover content
		const $studyDiscover = $("#studyDiscover");
		if ($studyDiscover.length === 0) return;

		// Find all verse sections in the study panel
		$studyDiscover.find("h3, h2").each((_, header) => {
			const $header = $(header);
			const headerText = $header.text().trim();

			// Extract verse number from header (e.g., "John 3:16" or just "3:16")
			const verseMatch = headerText.match(/:(\d+)$/);
			if (!verseMatch) return;

			const verseNum = parseInt(verseMatch[1], 10);
			const verse = verseMap.get(verseNum);
			if (!verse) return;

			// Get the content section following this header
			let $section = $header.next();
			const sectionContent: cheerio.Cheerio<any>[] = [];

			while ($section.length && !$section.is("h2, h3")) {
				sectionContent.push($section);
				$section = $section.next();
			}

			// Process the content
			for (const $content of sectionContent) {
				const className = $content.attr("class") || "";

				// Study notes
				if (includeStudyNotes && className.includes("studyNote")) {
					const studyNotes = verse.studyNotes || [];
					const phrase =
						$content.find("strong").first().text().trim() ||
						$content.find("b").first().text().trim();
					const explanation = $content
						.text()
						.replace(phrase, "")
						.trim()
						.replace(/\s+/g, " ");

					if (phrase || explanation) {
						const refs: string[] = [];
						$content.find('a[href*="/wol/bc/"]').each((_, ref) => {
							const refText = $(ref).text().trim();
							if (refText) refs.push(refText);
						});

						studyNotes.push({
							phrase,
							explanation,
							references: refs.length > 0 ? refs : undefined,
						});
					}
					verse.studyNotes = studyNotes;
				}

				// Cross references (Marginal References)
				if (includeCrossReferences && $content.text().includes("+")) {
					const crossRefs = verse.crossReferences || [];
					$content.find('a[href*="/wol/bc/"]').each((_, ref) => {
						const refText = $(ref).text().trim();
						if (refText && !crossRefs.includes(refText)) {
							crossRefs.push(refText);
						}
					});
					if (crossRefs.length > 0) {
						verse.crossReferences = crossRefs;
					}
				}

				// Media items
				if (includeMedia && className.includes("studyItemMedia")) {
					const media = verse.media || [];
					$content.find("a").each((_, link) => {
						const $link = $(link);
						const href = $link.attr("href") || "";
						const title = $link.text().trim();

						if (href && title) {
							// Extract timestamp from text or URL
							const tsMatch =
								title.match(
									/(\d+:\d+(?::\d+)?(?:\.\d+)?-\d+:\d+(?::\d+)?(?:\.\d+)?)/,
								) || href.match(/ts=([^&]+)/);
							const timestamp = tsMatch ? tsMatch[1] : undefined;

							// Make URL absolute
							const absoluteUrl = href.startsWith("http")
								? href
								: `${WOL_BASE_URL}${href}`;

							media.push({
								title: title.replace(/\([^)]*\)$/, "").trim(),
								url: absoluteUrl,
								timestamp,
							});
						}
					});
					if (media.length > 0) {
						verse.media = media;
					}
				}
			}
		});

		// Also parse from the marginals section for cross-references
		if (includeCrossReferences) {
			const $marginals = $("#studyMarginals");
			$marginals.find("tr, .verseRef").each((_, row) => {
				const $row = $(row);
				const rowText = $row.text().trim();

				// Try to extract verse number
				const verseMatch = rowText.match(/^(\d+):(\d+)/);
				if (!verseMatch) return;

				const verseNum = parseInt(verseMatch[2], 10);
				const verse = verseMap.get(verseNum);
				if (!verse) return;

				const crossRefs = verse.crossReferences || [];
				$row.find('a[href*="/wol/bc/"]').each((_, ref) => {
					const refText = $(ref).text().trim();
					if (refText && !crossRefs.includes(refText)) {
						crossRefs.push(refText);
					}
				});

				if (crossRefs.length > 0) {
					verse.crossReferences = crossRefs;
				}
			});
		}
	}

	private static parseIndexPage(
		html: string,
		book: number,
		chapter: number,
		verseStart?: number,
		verseEnd?: number,
	): Map<number, BibleIndex[]> {
		const $ = cheerio.load(html);
		const bookInfo = BIBLE_BOOKS[book];
		const isSingleChapter = bookInfo.chapters === 1;
		const result = new Map<number, BibleIndex[]>();

		let currentVerseNum: number | null = null;
		let currentPubName: string | null = null;
		let currentPubHref: string | null = null;
		let pendingEntries: BibleIndex[] = [];

		const flushPub = () => {
			if (currentVerseNum !== null && currentPubName !== null) {
				// Fallback: publication with no specific page detail
				if (pendingEntries.length === 0 && currentPubHref) {
					pendingEntries.push({
						title: currentPubName,
						publication: currentPubName,
						url: currentPubHref,
					});
				}
				const arr = result.get(currentVerseNum) || [];
				arr.push(...pendingEntries);
				result.set(currentVerseNum, arr);
			}
			currentPubName = null;
			currentPubHref = null;
			pendingEntries = [];
		};

		$("p.se, p.su, p.sk").each((_, el) => {
			const $el = $(el);
			const className = $el.attr("class") || "";

			if (className.includes("se")) {
				// Verse marker — flush previous data
				flushPub();

				const strong = $el.find("a.b[data-bid] strong").first();
				const text = strong.text().trim();

				if (isSingleChapter) {
					const v = Number.parseInt(text, 10);
					currentVerseNum =
						!Number.isNaN(v) &&
						(!verseStart || v >= verseStart) &&
						(!verseEnd || v <= verseEnd)
							? v
							: null;
				} else {
					const m = text.match(/^(\d+):(\d+)$/);
					if (m) {
						const ch = Number.parseInt(m[1], 10);
						const v = Number.parseInt(m[2], 10);
						currentVerseNum =
							ch === chapter &&
							(!verseStart || v >= verseStart) &&
							(!verseEnd || v <= verseEnd)
								? v
								: null;
					} else {
						currentVerseNum = null;
					}
				}
				return;
			}

			if (currentVerseNum === null) return;

			if (className.includes("su")) {
				// Reference entries
				$el.find("a").each((_, link) => {
					const $link = $(link);
					const href = $link.attr("href") || "";
					const hasEm = $link.find("em").length > 0;
					const linkText = $link
						.text()
						.replace(/\u00A0/g, " ")
						.replace(/\s+/g, " ")
						.trim()
						.replace(/,+$/, "");

					if (!linkText) return;

					const absoluteUrl = href.startsWith("http")
						? href
						: `${WOL_BASE_URL}${href}`;

					if (hasEm) {
						flushPub();
						const { pubName, detail } = splitPubDetail(linkText);
						currentPubName = pubName;
						currentPubHref = absoluteUrl;
						if (detail) {
							pendingEntries.push({
								title: detail,
								publication: currentPubName,
								url: absoluteUrl,
							});
						}
					} else if (currentPubName) {
						pendingEntries.push({
							title: linkText,
							publication: currentPubName,
							url: absoluteUrl,
						});
					}
				});
			} else if (className.includes("sk")) {
				// Date/issue sub-entries
				if (!currentPubName) return;

				$el.find("a").each((_, link) => {
					const $link = $(link);
					const href = $link.attr("href") || "";
					const linkText = $link
						.text()
						.replace(/\u00A0/g, " ")
						.replace(/\s+/g, " ")
						.trim()
						.replace(/,+$/, "");

					if (!linkText || !href) return;

					const absoluteUrl = href.startsWith("http")
						? href
						: `${WOL_BASE_URL}${href}`;

					pendingEntries.push({
						title: linkText,
						publication: currentPubName!,
						url: absoluteUrl,
					});
				});
			}
		});

		// Flush the last verse
		flushPub();

		return result;
	}
}
