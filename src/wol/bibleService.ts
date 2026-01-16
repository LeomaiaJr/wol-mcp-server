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
		const response = await BibleService.fetchWithRetry(url);
		const html = await response.text();

		return BibleService.parseBibleContent(html, {
			book,
			chapter,
			verseStart,
			verseEnd,
			language,
			url,
			includeStudyNotes,
			includeCrossReferences,
			includeMedia,
			includeIndexes,
		});
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
			includeIndexes: boolean;
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
			includeIndexes,
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
		if (
			includeStudyNotes ||
			includeCrossReferences ||
			includeMedia ||
			includeIndexes
		) {
			BibleService.parseStudyContent($, sortedVerses, book, chapter, {
				includeStudyNotes,
				includeCrossReferences,
				includeMedia,
				includeIndexes,
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
			includeIndexes: boolean;
		},
	): void {
		const {
			includeStudyNotes,
			includeCrossReferences,
			includeMedia,
			includeIndexes,
		} = options;

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

				// Indexes (publication references)
				if (includeIndexes && className.includes("index")) {
					const indexes = verse.indexes || [];
					$content.find("a").each((_, link) => {
						const $link = $(link);
						const href = $link.attr("href") || "";
						const title = $link.text().trim();

						if (href && title) {
							// Determine publication type from the reference
							let publication = "Publication";
							if (title.includes("Insight") || href.includes("/it-")) {
								publication = "Insight on the Scriptures";
							} else if (title.includes("Watchtower") || title.match(/^w\d+/)) {
								publication = "The Watchtower";
							} else if (title.includes("Awake") || title.match(/^g\d+/)) {
								publication = "Awake!";
							}

							const absoluteUrl = href.startsWith("http")
								? href
								: `${WOL_BASE_URL}${href}`;

							indexes.push({
								title,
								publication,
								url: absoluteUrl,
							});
						}
					});
					if (indexes.length > 0) {
						verse.indexes = indexes;
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
}
