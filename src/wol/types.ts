import { z } from "zod";

export type PublicationType =
	| "w" // Watchtower
	| "g" // Awake!
	| "bk" // Books
	| "bi" // Bibles
	| "it" // Insight
	| "dx" // Indexes / Research Guides
	| "yb" // Yearbooks
	| "syr" // Service Year Report
	| "sgbk" // Songbooks
	| "mwb" // Meeting Workbooks
	| "km" // Kingdom Ministry
	| "brch" // Brochures
	| "bklt" // Booklets
	| "es" // Examining the Scriptures
	| "trct" // Tracts
	| "kn" // Kingdom News
	| "pgm" // Programs
	| "ca-copgm" // Assembly Program With CO
	| "ca-brpgm" // Assembly Program With BR
	| "co-pgm" // Convention Program
	| "manual" // Manuals and Guidelines
	| "gloss" // Glossary
	| "web"; // Web content

export type SearchScope = "sen" | "par" | "art"; // sentence | paragraph | article
export type SortType = "occ" | "newest" | "oldest"; // occurrences | date newest | date oldest

export interface WOLEndpoints {
	SEARCH: string;
	DOCUMENT: string;
	LIBRARY: string;
	HOME: string;
}

export interface SearchOptions {
	useOperators?: boolean;
	scope?: SearchScope;
	publications?: PublicationType[];
	language?: string;
	limit?: number;
	sort?: SortType;
	page?: number;
}

export interface SearchQuery {
	query: string;
	useOperators?: boolean;
	options?: SearchOptions;
}

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	publication: string;
	date?: string;
	occurrences?: number;
	documentId?: string;
	resultType?: "key_publication" | "document_result" | "subheading";
	subheadings?: string[];
	contextSnippets?: string[];
	publicationCode?: string;
}

export interface SearchPagination {
	totalResults: number;
	pageSize: number;
	totalPages: number;
	currentPage: number;
}

export interface SearchResponse {
	results: SearchResult[];
	pagination: SearchPagination;
}

export interface Document {
	id: string;
	title: string;
	content: string;
	publication: string;
	url: string;
	language: string;
	metadata?: {
		author?: string;
		date?: string;
		series?: string;
		volume?: string;
		issue?: string;
	};
	subheadings?: Array<{ title: string; url: string }>;
	similarMaterials?: Array<{ title: string; subtitle?: string; url: string }>;
}

export interface Publication {
	code: PublicationType;
	name: string;
	description: string;
	years?: number[];
	language: string;
}

export const SearchOptionsSchema = z.object({
	query: z.string().min(1, "Search query cannot be empty"),
	useOperators: z.boolean().optional().default(true),
	scope: z.enum(["sen", "par", "art"]).optional().default("par"),
	publications: z
		.array(
			z.enum([
				"w",
				"g",
				"bk",
				"bi",
				"it",
				"dx",
				"yb",
				"syr",
				"sgbk",
				"mwb",
				"km",
				"brch",
				"bklt",
				"es",
				"trct",
				"kn",
				"pgm",
				"ca-copgm",
				"ca-brpgm",
				"co-pgm",
				"manual",
				"gloss",
				"web",
			]),
		)
		.optional(),
	language: z.string().optional().default("en"),
	limit: z.number().int().min(1).max(100).optional().default(10),
	sort: z.enum(["occ", "newest", "oldest"]).optional().default("occ"),
	page: z.number().int().min(1).optional().default(1),
});

export const DocumentRetrievalSchema = z.object({
	url: z.string().url("A valid WOL document URL is required"),
});

export const PublicationBrowseSchema = z.object({
	type: z
		.enum([
			"w",
			"g",
			"bk",
			"bi",
			"it",
			"dx",
			"yb",
			"syr",
			"sgbk",
			"mwb",
			"km",
			"brch",
			"bklt",
			"es",
			"trct",
			"kn",
			"pgm",
			"ca-copgm",
			"ca-brpgm",
			"co-pgm",
			"manual",
			"gloss",
			"web",
		])
		.optional(),
	language: z.string().optional().default("en"),
	year: z.number().int().min(1950).max(new Date().getFullYear()).optional(),
});

export interface WOLError extends Error {
	code:
		| "SERVICE_UNAVAILABLE"
		| "NOT_FOUND"
		| "INVALID_QUERY"
		| "NETWORK_ERROR"
		| "PARSE_ERROR";
	details?: any;
}

// Video Subtitle Types
export interface VideoSubtitleInfo {
	url: string;
	modifiedDatetime: string;
	checksum: string;
}

export interface VideoMetadata {
	title: string;
	publication: string;
	pub: string;
	track: number;
	language: string;
	duration: number;
	availableResolutions: string[];
	thumbnailUrl?: string;
}

export interface VideoSubtitleResult {
	metadata: VideoMetadata;
	subtitles: {
		vttUrl: string;
		rawVtt: string;
		plainText: string;
	};
}

export const VideoSubtitleSchema = z.object({
	url: z.string().min(1, "Video URL is required"),
	format: z.enum(["vtt", "text", "both"]).optional().default("text"),
	startTime: z
		.number()
		.min(0)
		.optional()
		.describe("Start time in seconds to filter subtitles (default: 0)"),
	endTime: z
		.number()
		.min(0)
		.optional()
		.describe(
			"End time in seconds to filter subtitles (default: video duration)",
		),
});

export const PUBLICATION_NAMES: Record<PublicationType, string> = {
	w: "The Watchtower",
	g: "Awake!",
	bk: "Books",
	bi: "Bibles",
	it: "Insight",
	dx: "Indexes",
	yb: "Yearbooks",
	syr: "Service Year Report",
	sgbk: "Songbooks",
	mwb: "Meeting Workbook",
	km: "Kingdom Ministry",
	brch: "Brochures",
	bklt: "Booklets",
	es: "Examining the Scriptures",
	trct: "Tracts",
	kn: "Kingdom News",
	pgm: "Programs",
	"ca-copgm": "Assembly Program With CO",
	"ca-brpgm": "Assembly Program With BR",
	"co-pgm": "Convention Program",
	manual: "Manuals and Guidelines",
	gloss: "Glossary",
	web: "Web Content",
};

// Bible Text Types
export interface BibleStudyNote {
	phrase: string;
	explanation: string;
	references?: string[];
}

export interface BibleCrossReference {
	verse: string;
	references: string[];
}

export interface BibleMedia {
	title: string;
	url: string;
	timestamp?: string;
	thumbnailUrl?: string;
}

export interface BibleIndex {
	title: string;
	publication: string;
	url: string;
}

export interface BibleFootnote {
	marker: string;
	text: string;
}

export interface BibleVerse {
	number: number;
	text: string;
	footnotes?: BibleFootnote[];
	studyNotes?: BibleStudyNote[];
	crossReferences?: string[];
	media?: BibleMedia[];
	indexes?: BibleIndex[];
}

export interface BibleTextResult {
	reference: string;
	book: {
		number: number;
		name: string;
	};
	chapter: number;
	verses: BibleVerse[];
	url: string;
	language: string;
}

export const BibleTextSchema = z.object({
	book: z
		.number()
		.int()
		.min(1)
		.max(66)
		.describe(
			"Bible book number (1-66, e.g., 1=Genesis, 43=John, 66=Revelation)",
		),
	chapter: z.number().int().min(1).describe("Chapter number"),
	verseStart: z
		.number()
		.int()
		.min(1)
		.optional()
		.describe("Starting verse number (default: 1)"),
	verseEnd: z
		.number()
		.int()
		.min(1)
		.optional()
		.describe("Ending verse number (default: last verse of chapter)"),
	language: z
		.string()
		.optional()
		.default("en")
		.describe("ISO language code (e.g., 'en', 'es', 'pt')"),
	includeStudyNotes: z
		.boolean()
		.optional()
		.default(true)
		.describe("Include study notes for each verse"),
	includeCrossReferences: z
		.boolean()
		.optional()
		.default(true)
		.describe("Include cross-references to other Bible verses"),
	includeMedia: z
		.boolean()
		.optional()
		.default(true)
		.describe("Include related videos and media"),
	includeIndexes: z
		.boolean()
		.optional()
		.default(true)
		.describe(
			"Include links to related publications (Insight, Watchtower, etc.)",
		),
});

// Bible book names in English (for reference generation)
export const BIBLE_BOOKS: Record<
	number,
	{ name: string; abbrev: string; chapters: number }
> = {
	1: { name: "Genesis", abbrev: "Ge", chapters: 50 },
	2: { name: "Exodus", abbrev: "Ex", chapters: 40 },
	3: { name: "Leviticus", abbrev: "Le", chapters: 27 },
	4: { name: "Numbers", abbrev: "Nu", chapters: 36 },
	5: { name: "Deuteronomy", abbrev: "De", chapters: 34 },
	6: { name: "Joshua", abbrev: "Jos", chapters: 24 },
	7: { name: "Judges", abbrev: "Jg", chapters: 21 },
	8: { name: "Ruth", abbrev: "Ru", chapters: 4 },
	9: { name: "1 Samuel", abbrev: "1Sa", chapters: 31 },
	10: { name: "2 Samuel", abbrev: "2Sa", chapters: 24 },
	11: { name: "1 Kings", abbrev: "1Ki", chapters: 22 },
	12: { name: "2 Kings", abbrev: "2Ki", chapters: 25 },
	13: { name: "1 Chronicles", abbrev: "1Ch", chapters: 29 },
	14: { name: "2 Chronicles", abbrev: "2Ch", chapters: 36 },
	15: { name: "Ezra", abbrev: "Ezr", chapters: 10 },
	16: { name: "Nehemiah", abbrev: "Ne", chapters: 13 },
	17: { name: "Esther", abbrev: "Es", chapters: 10 },
	18: { name: "Job", abbrev: "Job", chapters: 42 },
	19: { name: "Psalms", abbrev: "Ps", chapters: 150 },
	20: { name: "Proverbs", abbrev: "Pr", chapters: 31 },
	21: { name: "Ecclesiastes", abbrev: "Ec", chapters: 12 },
	22: { name: "Song of Solomon", abbrev: "Ca", chapters: 8 },
	23: { name: "Isaiah", abbrev: "Isa", chapters: 66 },
	24: { name: "Jeremiah", abbrev: "Jer", chapters: 52 },
	25: { name: "Lamentations", abbrev: "La", chapters: 5 },
	26: { name: "Ezekiel", abbrev: "Eze", chapters: 48 },
	27: { name: "Daniel", abbrev: "Da", chapters: 12 },
	28: { name: "Hosea", abbrev: "Ho", chapters: 14 },
	29: { name: "Joel", abbrev: "Joe", chapters: 3 },
	30: { name: "Amos", abbrev: "Am", chapters: 9 },
	31: { name: "Obadiah", abbrev: "Ob", chapters: 1 },
	32: { name: "Jonah", abbrev: "Jon", chapters: 4 },
	33: { name: "Micah", abbrev: "Mic", chapters: 7 },
	34: { name: "Nahum", abbrev: "Na", chapters: 3 },
	35: { name: "Habakkuk", abbrev: "Hab", chapters: 3 },
	36: { name: "Zephaniah", abbrev: "Zep", chapters: 3 },
	37: { name: "Haggai", abbrev: "Hag", chapters: 2 },
	38: { name: "Zechariah", abbrev: "Zec", chapters: 14 },
	39: { name: "Malachi", abbrev: "Mal", chapters: 4 },
	40: { name: "Matthew", abbrev: "Mt", chapters: 28 },
	41: { name: "Mark", abbrev: "Mr", chapters: 16 },
	42: { name: "Luke", abbrev: "Lu", chapters: 24 },
	43: { name: "John", abbrev: "Joh", chapters: 21 },
	44: { name: "Acts", abbrev: "Ac", chapters: 28 },
	45: { name: "Romans", abbrev: "Ro", chapters: 16 },
	46: { name: "1 Corinthians", abbrev: "1Co", chapters: 16 },
	47: { name: "2 Corinthians", abbrev: "2Co", chapters: 13 },
	48: { name: "Galatians", abbrev: "Ga", chapters: 6 },
	49: { name: "Ephesians", abbrev: "Eph", chapters: 6 },
	50: { name: "Philippians", abbrev: "Php", chapters: 4 },
	51: { name: "Colossians", abbrev: "Col", chapters: 4 },
	52: { name: "1 Thessalonians", abbrev: "1Th", chapters: 5 },
	53: { name: "2 Thessalonians", abbrev: "2Th", chapters: 3 },
	54: { name: "1 Timothy", abbrev: "1Ti", chapters: 6 },
	55: { name: "2 Timothy", abbrev: "2Ti", chapters: 4 },
	56: { name: "Titus", abbrev: "Tit", chapters: 3 },
	57: { name: "Philemon", abbrev: "Phm", chapters: 1 },
	58: { name: "Hebrews", abbrev: "Heb", chapters: 13 },
	59: { name: "James", abbrev: "Jas", chapters: 5 },
	60: { name: "1 Peter", abbrev: "1Pe", chapters: 5 },
	61: { name: "2 Peter", abbrev: "2Pe", chapters: 3 },
	62: { name: "1 John", abbrev: "1Jo", chapters: 5 },
	63: { name: "2 John", abbrev: "2Jo", chapters: 1 },
	64: { name: "3 John", abbrev: "3Jo", chapters: 1 },
	65: { name: "Jude", abbrev: "Jude", chapters: 1 },
	66: { name: "Revelation", abbrev: "Re", chapters: 22 },
};
