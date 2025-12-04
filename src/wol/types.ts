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
