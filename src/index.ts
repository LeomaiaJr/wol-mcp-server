import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import { WOLService } from "./wol/wolService";
import { VideoService } from "./wol/videoService";
import { BibleService } from "./wol/bibleService";
import {
	SearchOptionsSchema,
	DocumentRetrievalSchema,
	PublicationBrowseSchema,
	VideoSubtitleSchema,
	BibleTextSchema,
	BIBLE_BOOKS,
} from "./wol/types";

// Define our MCP agent with WOL tools
export class MyMCP extends McpAgent {
	server = new McpServer({
		name: "wol-mcp-server",
		version: "1.0.0",
	});

	async init() {
		// wol_search
		this.server.tool(
			"wol_search",
			SearchOptionsSchema.shape, // accepts same fields as original schema
			async (args: z.infer<typeof SearchOptionsSchema>) => {
				const validated = SearchOptionsSchema.parse(args);
				const { results, pagination } = await WOLService.search(
					validated.query,
					{
						scope: validated.scope,
						publications: validated.publications,
						language: validated.language,
						limit: validated.limit,
						sort: validated.sort,
						page: validated.page,
						useOperators: validated.useOperators,
					},
				);

				const keyPublications = results.filter(
					(r) => r.resultType === "key_publication",
				);
				const documents = results.filter(
					(r) => r.resultType === "document_result",
				);

				const header = `Search results for "${validated.query}" — page ${pagination.currentPage}/${pagination.totalPages} — total ${pagination.totalResults} results (page size ${pagination.pageSize}).`;

				const keyPubSection =
					`Key Publications (${keyPublications.length}):\n\n` +
					(keyPublications.length > 0
						? keyPublications
								.map((result, i) => {
									let output = `- ${i + 1}. ${result.title}\n`;
									output += `  Publication: ${result.publication}\n`;
									output += `  URL: ${result.url}\n`;
									if (result.subheadings && result.subheadings.length > 0) {
										output += `  Sections: ${result.subheadings.join("; ")}\n`;
									}
									return output;
								})
								.join("\n") + "\n"
						: "(none)\n");

				const docSection =
					`Documents (showing up to ${validated.limit ?? 10}):\n\n` +
					(documents.length > 0
						? documents
								.map((result, i) => {
									let output =
										`- ${i + 1}. ${result.title}` +
										(result.occurrences
											? ` — Occurrences: ${result.occurrences}`
											: "") +
										"\n";
									output += `  Publication: ${result.publication}\n`;
									output += `  URL: ${result.url}\n`;
									if (
										result.contextSnippets &&
										result.contextSnippets.length > 0
									) {
										output += `  Preview: ${result.contextSnippets
											.slice(0, 2)
											.join(" | ")}\n`;
									} else if ((result as any).snippet) {
										output += `  Preview: ${(result as any).snippet}\n`;
									}
									return output;
								})
								.join("\n") + "\n"
						: "(none)\n");

				return {
					content: [
						{
							type: "text",
							text: `${header}\n\n${keyPubSection}\n${docSection}`,
						},
					],
				};
			},
		);

		// wol_get_document
		this.server.tool(
			"wol_get_document",
			DocumentRetrievalSchema.shape,
			async (args: z.infer<typeof DocumentRetrievalSchema>) => {
				const validated = DocumentRetrievalSchema.parse(args);
				const document = await WOLService.getDocumentByUrl(validated.url);
				let formattedContent = `# ${document.title}\n\n`;
				formattedContent += `Publication: ${document.publication}\n`;
				formattedContent += `URL: ${document.url}\n`;
				if (document.metadata) {
					if (document.metadata.date)
						formattedContent += `Date: ${document.metadata.date}\n`;
					if ((document.metadata as any).volume)
						formattedContent += `Volume: ${
							(document.metadata as any).volume
						}\n`;
					if ((document.metadata as any).issue)
						formattedContent += `Issue: ${(document.metadata as any).issue}\n`;
				}
				if (document.subheadings && document.subheadings.length > 0) {
					formattedContent += `\nSubheadings (${document.subheadings.length}):\n`;
					formattedContent +=
						document.subheadings
							.map((s) => `- ${s.title}\n  ${s.url}`)
							.join("\n") + "\n";
				}
				if (document.similarMaterials && document.similarMaterials.length > 0) {
					formattedContent += `\nSimilar Material (${document.similarMaterials.length}):\n`;
					formattedContent +=
						document.similarMaterials
							.map(
								(s) =>
									`- ${s.title}${s.subtitle ? ` — ${s.subtitle}` : ""}\n  ${
										s.url
									}`,
							)
							.join("\n") + "\n";
				}
				formattedContent += `\n\n${document.content}`;
				return { content: [{ type: "text", text: formattedContent }] };
			},
		);

		// wol_browse_publications
		this.server.tool(
			"wol_browse_publications",
			PublicationBrowseSchema.shape,
			async (args: z.infer<typeof PublicationBrowseSchema>) => {
				const validated = PublicationBrowseSchema.parse(args);
				const publications = await WOLService.browsePublications(
					validated.type,
					validated.language,
					validated.year,
				);
				const formatted = publications
					.map(
						(pub) =>
							`**${pub.name}** (${pub.code})\n` +
							`Description: ${pub.description}\n` +
							`Language: ${pub.language}\n` +
							(pub.years ? `Years: ${pub.years.join(", ")}\n` : "") +
							`---\n`,
					)
					.join("\n");
				return {
					content: [
						{ type: "text", text: `Available Publications:\n\n${formatted}` },
					],
				};
			},
		);

		// wol_get_video_subtitles
		this.server.tool(
			"wol_get_video_subtitles",
			VideoSubtitleSchema.shape,
			async (args: z.infer<typeof VideoSubtitleSchema>) => {
				const validated = VideoSubtitleSchema.parse(args);
				const result = await VideoService.getVideoSubtitles(
					validated.url,
					validated.format,
					validated.startTime,
					validated.endTime,
				);

				let formattedContent = `# ${result.metadata.title}\n\n`;
				formattedContent += `Publication: ${result.metadata.publication}\n`;
				formattedContent += `Language: ${result.metadata.language}\n`;
				formattedContent += `Duration: ${Math.floor(result.metadata.duration / 60)}m ${Math.floor(result.metadata.duration % 60)}s\n`;
				formattedContent += `Available Resolutions: ${result.metadata.availableResolutions.join(", ")}\n`;
				if (result.metadata.thumbnailUrl) {
					formattedContent += `Thumbnail: ${result.metadata.thumbnailUrl}\n`;
				}
				formattedContent += `Subtitle URL: ${result.subtitles.vttUrl}\n`;

				if (result.subtitles.plainText) {
					formattedContent += `\n## Transcript\n\n${result.subtitles.plainText}`;
				}

				if (result.subtitles.rawVtt) {
					formattedContent += `\n## Raw VTT\n\n\`\`\`vtt\n${result.subtitles.rawVtt}\n\`\`\``;
				}

				return { content: [{ type: "text", text: formattedContent }] };
			},
		);

		// wol_get_bible_text
		this.server.tool(
			"wol_get_bible_text",
			`Retrieve Bible text from the Study Edition (nwtsty). Returns the text along with study notes, cross-references to other Bible verses, related videos/media, and comprehensive links to supporting publications from the Index to Bible Publications that explain and expand on the Bible text. Supports multiple languages.

Examples:
- Single verse: { book: 43, chapter: 3, verseStart: 16 } → John 3:16
- Verse range: { book: 43, chapter: 3, verseStart: 16, verseEnd: 18 } → John 3:16-18
- Entire chapter: { book: 1, chapter: 1 } → Genesis 1 (all verses)
- Different language: { book: 43, chapter: 3, verseStart: 16, language: "pt" } → João 3:16 (Portuguese)

Note: Verse ranges are limited to a single chapter. For multiple chapters, make separate requests.

Book numbers: 1=Genesis, 2=Exodus... 19=Psalms, 20=Proverbs... 40=Matthew, 41=Mark, 42=Luke, 43=John... 66=Revelation`,
			BibleTextSchema.shape,
			async (args: z.infer<typeof BibleTextSchema>) => {
				const validated = BibleTextSchema.parse(args);
				const result = await BibleService.getBibleText({
					book: validated.book,
					chapter: validated.chapter,
					verseStart: validated.verseStart,
					verseEnd: validated.verseEnd,
					language: validated.language,
					includeStudyNotes: validated.includeStudyNotes,
					includeCrossReferences: validated.includeCrossReferences,
					includeMedia: validated.includeMedia,
					includeIndexes: validated.includeIndexes,
				});

				let formattedContent = `# ${result.reference}\n\n`;
				formattedContent += `Book: ${result.book.name} (Book ${result.book.number})\n`;
				formattedContent += `Chapter: ${result.chapter}\n`;
				formattedContent += `Language: ${result.language}\n`;
				formattedContent += `URL: ${result.url}\n`;
				formattedContent += `\n---\n\n`;

				// Format verses
				formattedContent += `## Verses\n\n`;
				for (const verse of result.verses) {
					formattedContent += `**${verse.number}** ${verse.text}\n\n`;

					// Study notes
					if (verse.studyNotes && verse.studyNotes.length > 0) {
						formattedContent += `  📖 **Study Notes:**\n`;
						for (const note of verse.studyNotes) {
							formattedContent += `  - **${note.phrase}**: ${note.explanation}`;
							if (note.references && note.references.length > 0) {
								formattedContent += ` (${note.references.join("; ")})`;
							}
							formattedContent += `\n`;
						}
						formattedContent += `\n`;
					}

					// Cross references
					if (verse.crossReferences && verse.crossReferences.length > 0) {
						formattedContent += `  🔗 **Cross-References:** ${verse.crossReferences.join("; ")}\n\n`;
					}

					// Media
					if (verse.media && verse.media.length > 0) {
						formattedContent += `  🎬 **Related Media:**\n`;
						for (const media of verse.media) {
							formattedContent += `  - ${media.title}`;
							if (media.timestamp) {
								formattedContent += ` (${media.timestamp})`;
							}
							formattedContent += `\n    ${media.url}\n`;
						}
						formattedContent += `\n`;
					}

					// Indexes
					if (verse.indexes && verse.indexes.length > 0) {
						formattedContent += `  📚 **Related Publications:**\n`;
						for (const idx of verse.indexes) {
							formattedContent += `  - ${idx.title} (${idx.publication})\n    ${idx.url}\n`;
						}
						formattedContent += `\n`;
					}

					// Footnotes
					if (verse.footnotes && verse.footnotes.length > 0) {
						formattedContent += `  📝 **Footnotes:** ${verse.footnotes.map((f) => f.marker).join(", ")}\n\n`;
					}
				}

				// Add book reference at the end
				formattedContent += `\n---\n\n`;
				formattedContent += `**Book Reference:** ${BIBLE_BOOKS[result.book.number]?.name || "Unknown"} has ${BIBLE_BOOKS[result.book.number]?.chapters || "?"} chapters.\n`;

				return { content: [{ type: "text", text: formattedContent }] };
			},
		);
	}
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
		}

		if (url.pathname === "/mcp") {
			return MyMCP.serve("/mcp").fetch(request, env, ctx);
		}

		return new Response("Not found", { status: 404 });
	},
};
