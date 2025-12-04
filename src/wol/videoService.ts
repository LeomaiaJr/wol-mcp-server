import type { VideoSubtitleResult, VideoMetadata, WOLError } from "./types";
import { createWOLError } from "./utils";

const JW_PUBMEDIA_API = "https://b.jw-cdn.org/apis/pub-media/GETPUBMEDIALINKS";

interface PubMediaVideoFile {
	title: string;
	label: string;
	duration: number;
	subtitles?: {
		url: string;
		modifiedDatetime: string;
		checksum: string;
	};
	trackImage?: {
		url: string;
	};
}

interface PubMediaResponse {
	pubName: string;
	pub: string;
	track: number;
	files: {
		[lang: string]: {
			MP4?: PubMediaVideoFile[];
		};
	};
}

interface ParsedVideoParams {
	pub: string;
	track: string;
	language: string;
}

export class VideoService {
	private static readonly MAX_RETRIES = 3;
	private static readonly TIMEOUT = 30000;

	/**
	 * Get video subtitles from a JW.org video URL
	 */
	static async getVideoSubtitles(
		url: string,
		format: "vtt" | "text" | "both" = "text",
		startTime?: number,
		endTime?: number,
	): Promise<VideoSubtitleResult> {
		try {
			// Parse the video URL to extract pub, track, and language
			const params = VideoService.parseVideoUrl(url);

			// Fetch video metadata from the pub-media API
			const metadata = await VideoService.fetchVideoMetadata(
				params.pub,
				params.track,
				params.language,
			);

			// Extract subtitle info from metadata
			const langFiles = metadata.files[params.language];
			if (!langFiles?.MP4 || langFiles.MP4.length === 0) {
				throw createWOLError(
					"NOT_FOUND",
					"No video files found for the specified language",
					{
						url,
						language: params.language,
					},
				);
			}

			const firstVideo = langFiles.MP4[0];
			if (!firstVideo.subtitles) {
				throw createWOLError(
					"NOT_FOUND",
					"No subtitles available for this video",
					{
						url,
						title: firstVideo.title,
					},
				);
			}

			// Fetch the VTT content
			let vttContent = await VideoService.fetchVttContent(
				firstVideo.subtitles.url,
			);

			// Filter by time range if specified
			if (startTime !== undefined || endTime !== undefined) {
				vttContent = VideoService.filterVttByTimeRange(
					vttContent,
					startTime ?? 0,
					endTime ?? firstVideo.duration,
				);
			}

			// Clean the VTT (remove positioning metadata)
			const cleanedVtt = VideoService.cleanVtt(vttContent);

			// Convert VTT to plain text
			const plainText = VideoService.vttToPlainText(vttContent);

			// Build video metadata
			const videoMetadata: VideoMetadata = {
				title: firstVideo.title,
				publication: metadata.pubName,
				pub: metadata.pub,
				track: metadata.track,
				language: params.language,
				duration: firstVideo.duration,
				availableResolutions: langFiles.MP4.map((v) => v.label),
				thumbnailUrl: firstVideo.trackImage?.url,
			};

			return {
				metadata: videoMetadata,
				subtitles: {
					vttUrl: firstVideo.subtitles.url,
					rawVtt: format === "text" ? "" : cleanedVtt,
					plainText: format === "vtt" ? "" : plainText,
				},
			};
		} catch (error) {
			if (error instanceof Error && (error as WOLError).code) {
				throw error;
			}

			throw createWOLError(
				"NETWORK_ERROR",
				`Failed to get video subtitles: ${error}`,
				{ url },
			);
		}
	}

	/**
	 * Parse a JW.org video share URL to extract publication, track, and language
	 *
	 * Supported URL formats:
	 * - https://www.jw.org/finder?srcid=jwlshare&wtlocale=T&lank=pub-jwbvod25_41_VIDEO
	 * - https://www.jw.org/pt/biblioteca/videos/?item=pub-jwbvod25_41_VIDEO&appLanguage=T
	 */
	private static parseVideoUrl(url: string): ParsedVideoParams {
		let urlObj: URL;
		try {
			urlObj = new URL(url);
		} catch {
			throw createWOLError("INVALID_QUERY", "Invalid URL format", { url });
		}

		const params = urlObj.searchParams;

		// Try to get language from wtlocale (finder URLs) or appLanguage (library URLs)
		const language = params.get("wtlocale") || params.get("appLanguage");

		if (!language) {
			throw createWOLError(
				"INVALID_QUERY",
				"Could not determine video language from URL. Expected 'wtlocale' or 'appLanguage' parameter.",
				{ url },
			);
		}

		// Try to get the lank/item parameter which contains pub and track
		const lank = params.get("lank") || params.get("item");

		if (!lank) {
			throw createWOLError(
				"INVALID_QUERY",
				"Could not find video identifier in URL. Expected 'lank' or 'item' parameter.",
				{ url },
			);
		}

		// Parse lank format: pub-{pub}_{track}_VIDEO
		// Examples: pub-jwbvod25_41_VIDEO, pub-mwbv_202501_1_VIDEO
		const lankMatch = lank.match(/^pub-([a-zA-Z0-9]+)_(.+)_VIDEO$/i);
		if (!lankMatch) {
			throw createWOLError(
				"INVALID_QUERY",
				`Invalid video identifier format: ${lank}. Expected format: pub-{pub}_{track}_VIDEO`,
				{ url, lank },
			);
		}

		const pub = lankMatch[1];
		const trackPart = lankMatch[2];

		// Track can be simple (41) or complex (202501_1)
		// For the API, we pass the full track part
		return { pub, track: trackPart, language };
	}

	/**
	 * Fetch video metadata from the pub-media API
	 */
	private static async fetchVideoMetadata(
		pub: string,
		track: string,
		language: string,
	): Promise<PubMediaResponse> {
		const apiUrl = new URL(JW_PUBMEDIA_API);
		apiUrl.searchParams.set("output", "json");
		apiUrl.searchParams.set("pub", pub);
		apiUrl.searchParams.set("track", track);
		apiUrl.searchParams.set("langwritten", language);
		apiUrl.searchParams.set("txtCMSLang", language);

		const response = await VideoService.fetchWithRetry(
			apiUrl.toString(),
			"application/json",
		);

		if (!response.ok) {
			if (response.status === 404) {
				throw createWOLError("NOT_FOUND", "Video not found", {
					pub,
					track,
					language,
				});
			}
			throw createWOLError(
				"SERVICE_UNAVAILABLE",
				`API request failed: ${response.status}`,
				{
					pub,
					track,
					language,
				},
			);
		}

		return response.json();
	}

	/**
	 * Fetch VTT content from URL
	 */
	private static async fetchVttContent(vttUrl: string): Promise<string> {
		const response = await VideoService.fetchWithRetry(vttUrl, "text/vtt");

		if (!response.ok) {
			throw createWOLError("NOT_FOUND", "Failed to fetch subtitle file", {
				vttUrl,
			});
		}

		return response.text();
	}

	/**
	 * Clean VTT content by removing positioning metadata that's not useful for LLMs
	 * Keeps timestamps and text, removes line/position/align attributes
	 */
	private static cleanVtt(vttContent: string): string {
		return vttContent
			.replace(/ line:\d+%/g, "")
			.replace(/ position:\d+%/g, "")
			.replace(/ align:\w+/g, "")
			.trim();
	}

	/**
	 * Parse VTT timestamp to seconds
	 * Format: HH:MM:SS.mmm or MM:SS.mmm
	 */
	private static parseVttTimestamp(timestamp: string): number {
		const parts = timestamp.trim().split(":");
		if (parts.length === 3) {
			const hours = parseInt(parts[0], 10);
			const minutes = parseInt(parts[1], 10);
			const seconds = parseFloat(parts[2]);
			return hours * 3600 + minutes * 60 + seconds;
		} else if (parts.length === 2) {
			const minutes = parseInt(parts[0], 10);
			const seconds = parseFloat(parts[1]);
			return minutes * 60 + seconds;
		}
		return 0;
	}

	/**
	 * Filter VTT content by time range
	 * Returns only cues that fall within the specified time range
	 */
	private static filterVttByTimeRange(
		vttContent: string,
		startTime: number,
		endTime: number,
	): string {
		const lines = vttContent.split("\n");
		const filteredLines: string[] = ["WEBVTT", ""];

		let i = 0;
		// Skip WEBVTT header
		while (i < lines.length && !lines[i].includes("-->")) {
			i++;
		}

		// Process cues
		while (i < lines.length) {
			const line = lines[i];

			// Check if this is a timestamp line
			if (line.includes("-->")) {
				const timestampMatch = line.match(
					/(\d+:[\d:.]+)\s*-->\s*(\d+:[\d:.]+)/,
				);
				if (timestampMatch) {
					const cueStart = VideoService.parseVttTimestamp(timestampMatch[1]);
					const cueEnd = VideoService.parseVttTimestamp(timestampMatch[2]);

					// Check if cue overlaps with the time range
					if (cueEnd >= startTime && cueStart <= endTime) {
						// Include this cue
						filteredLines.push(line);
						i++;

						// Add all text lines until empty line or next timestamp
						while (
							i < lines.length &&
							lines[i].trim() !== "" &&
							!lines[i].includes("-->")
						) {
							filteredLines.push(lines[i]);
							i++;
						}
						filteredLines.push("");
					} else {
						// Skip this cue
						i++;
						while (
							i < lines.length &&
							lines[i].trim() !== "" &&
							!lines[i].includes("-->")
						) {
							i++;
						}
					}
				} else {
					i++;
				}
			} else {
				i++;
			}
		}

		return filteredLines.join("\n").trim();
	}

	/**
	 * Convert VTT content to plain text (removing timestamps and formatting)
	 */
	private static vttToPlainText(vttContent: string): string {
		const lines = vttContent.split("\n");
		const textLines: string[] = [];
		let inCue = false;

		for (const line of lines) {
			const trimmed = line.trim();

			// Skip WEBVTT header and empty lines
			if (trimmed === "WEBVTT" || trimmed === "") {
				inCue = false;
				continue;
			}

			// Skip timestamp lines (contain -->)
			if (trimmed.includes("-->")) {
				inCue = true;
				continue;
			}

			// Skip cue identifiers (numeric lines before timestamps)
			if (/^\d+$/.test(trimmed)) {
				continue;
			}

			// Collect text lines
			if (inCue && trimmed) {
				// Remove VTT formatting tags, positioning, and escape sequences
				const cleanText = trimmed
					.replace(/<[^>]+>/g, "") // Remove HTML-like tags
					.replace(/\{[^}]+\}/g, "") // Remove style blocks
					.replace(/line:\d+%/g, "") // Remove line positioning
					.replace(/position:\d+%/g, "") // Remove position
					.replace(/align:\w+/g, "") // Remove alignment
					.replace(/\\/g, "") // Remove escape characters
					.trim();

				if (cleanText) {
					textLines.push(cleanText);
				}
			}
		}

		// Join lines, removing consecutive duplicates
		const uniqueLines: string[] = [];
		for (const line of textLines) {
			if (
				uniqueLines.length === 0 ||
				uniqueLines[uniqueLines.length - 1] !== line
			) {
				uniqueLines.push(line);
			}
		}

		return uniqueLines.join("\n");
	}

	/**
	 * Fetch with retry and exponential backoff
	 */
	private static async fetchWithRetry(
		url: string,
		accept: string,
	): Promise<Response> {
		for (let i = 0; i < VideoService.MAX_RETRIES; i++) {
			try {
				const controller = new AbortController();
				const timeoutId = setTimeout(
					() => controller.abort(),
					VideoService.TIMEOUT,
				);

				const response = await fetch(url, {
					signal: controller.signal,
					headers: {
						"User-Agent": "Mozilla/5.0 (compatible; WOL-MCP-Server/1.0)",
						Accept: accept,
					},
				});

				clearTimeout(timeoutId);
				return response;
			} catch (error) {
				console.warn(`Fetch attempt ${i + 1} failed:`, error);

				if (i === VideoService.MAX_RETRIES - 1) {
					throw error;
				}

				// Exponential backoff
				await new Promise((resolve) => setTimeout(resolve, 2 ** i * 1000));
			}
		}

		throw new Error("Max retries exceeded");
	}
}
