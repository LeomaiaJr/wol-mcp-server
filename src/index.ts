import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { z } from "zod";
import { WOLService } from "./wol/wolService";
import { VideoService } from "./wol/videoService";
import {
	SearchOptionsSchema,
	DocumentRetrievalSchema,
	PublicationBrowseSchema,
	VideoSubtitleSchema,
	PUBLICATION_NAMES,
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
