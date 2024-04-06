import { App, Plugin, Modal, Notice } from "obsidian";

const fetch = (...args) =>
	import("node-fetch").then(({ default: fetch }) => fetch(...args));

// Set this to true to enable the fallback language model
const USE_FALLBACK_LLM = true;

const ERROR_MESSAGE_DURATION = 8000;
const NOTICE_MESSAGE_DURATION = 4000;

export default class Wiki2note extends Plugin {
	async onload() {
		// This creates an icon in the left ribbon.
		this.addRibbonIcon("info", "wiki2note", (evt: MouseEvent) => {
			new WikipediaSearchModal(this.app).open();
		});

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: "wiki2note",
			name: "Wikipedia to Note",
			callback: () => {
				new WikipediaSearchModal(this.app).open();
			},
		});
	}
}
// Function to fetch article summary from Wikipedia
async function getArticleSummary(title: string) {
	// Add a slight delay to manage request rate
	await new Promise((resolve) => setTimeout(resolve, 200));

	const SUMMARY_URL = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
		title
	)}`;

	try {
		const response = await fetch(SUMMARY_URL);
		const data = (await response.json()) as any;
		const trueTitle = data.title || title;
		const summary = data.extract || "No summary available.";
		const trueUrl = data.content_urls?.desktop?.page || "";
		return { trueTitle, summary, trueUrl };
	} catch (error) {
		console.error("Failed to fetch summary:", error);
		return {
			trueTitle: title,
			summary: "Failed to fetch summary.",
			trueUrl: "",
		};
	}
}

// Function to search Wikipedia for a given term and return summaries
async function searchWikipedia(
	searchTerm: string,
	exitOnFail = false
): Promise<Array<{ trueTitle: string; summary: string; trueUrl: string }>> {
	// Add a slight delay before search to prevent burst requests
	await new Promise((resolve) => setTimeout(resolve, 200));

	const API_URL = "https://en.wikipedia.org/w/api.php";
	const searchParams = new URLSearchParams({
		action: "opensearch",
		search: searchTerm,
		limit: "5",
		namespace: "0",
		format: "json",
	});

	try {
		const response = await fetch(`${API_URL}?${searchParams.toString()}`);
		const results = (await response.json()) as any;
		const titles = results[1];
		const summaries = await Promise.all(
			titles.map((title: string) => getArticleSummary(title))
		);
		if (summaries.length === 0 && exitOnFail === false) {
			if (USE_FALLBACK_LLM === true) {
				new Notice(
					`No results found. Trying to search using the fallback language model.`,
					NOTICE_MESSAGE_DURATION
				);
				return await llmAssistedSearchFallback(searchTerm);
			}
		}
		return summaries; // Returns an array of objects with trueTitle, summary, and trueUrl
	} catch (error) {
		new Notice(`Error searching Wikipedia.`, ERROR_MESSAGE_DURATION);
		return Promise.resolve([]);
	}
}

async function llmAssistedSearchFallback(
	searchTerm: string
): Promise<Array<{ trueTitle: string; summary: string; trueUrl: string }>> {
	const openAIKey = process.env.OPENAI_API_KEY;
	if (!openAIKey) {
		new Notice(
			`OpenAI API key not found. Please set the OPENAI_API_KEY environment variable.`,
			ERROR_MESSAGE_DURATION
		);
		return [];
	} else {
		try {
			const response = await fetch(
				"https://api.openai.com/v1/chat/completions",
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${openAIKey}`,
					},
					body: JSON.stringify({
						model: "gpt-3.5-turbo",
						messages: [
							{
								role: "user",
								content: `The user is attempting to find a Wikipedia article and need your assistance.\n\nGiven the following query by the user:\n\"${searchTerm}\"\n\nPonder on what the user is trying to find and suggest the proper keyword to query in an opensearch query to the English Wikipedia official API.\n\nAnswer in a JSON format containing the \`query\` attribute.`,
							},
						],
						max_tokens: 50,
						response_format: { type: "json_object" },
					}),
				}
			);

			const data = (await response.json()) as any;
			const answer = JSON.parse(data.choices[0].message.content);
			if (!answer.query) {
				new Notice(
					`The model failed to respond. Exiting.`,
					ERROR_MESSAGE_DURATION
				);
				return [];
			}
			new Notice(
				`Searching for:\n${answer.query}`,
				NOTICE_MESSAGE_DURATION
			);
			return await searchWikipedia(answer.query, true);
		} catch (error) {
			new Notice(
				`Error searching Wikipedia using the fallback language model.`,
				ERROR_MESSAGE_DURATION
			);
			return Promise.resolve([]);
		}
	}
}

class WikipediaSearchModal extends Modal {
	private resultsContainer: HTMLElement | null;
	private searchInput: HTMLInputElement | null;

	constructor(app: App) {
		super(app);
		this.resultsContainer = null;
		this.searchInput = null;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("quick-switcher");

		contentEl.createEl(
			"input",
			{ type: "text", placeholder: "Find or create a note..." },
			(input) => {
				this.searchInput = input;
				this.searchInput.addEventListener("keydown", async (e) => {
					if (e.key === "Enter") {
						const value = this.searchInput.value;
						if (value) {
							const results = await searchWikipedia(value);
							this.updateResults(
								results.map(
									({ trueTitle, summary, trueUrl }) => ({
										title: trueTitle,
										summary: summary,
										url: trueUrl,
									})
								)
							);
						} else {
							this.clearResults();
						}
					}
				});
				input.addClass("quick-switcher-input");
			}
		);

		this.resultsContainer = contentEl.createDiv("quick-switcher-results");
	}

	private clearResults() {
		if (this.resultsContainer) {
			this.resultsContainer.empty();
		}
	}

	private updateResults(
		results: Array<{ title: string; summary: string; url: string }>
	) {
		this.clearResults();

		results.forEach((result, index) => {
			const resultEl = this.resultsContainer.createEl("div", {
				cls: "quick-switcher-item",
			});

			resultEl.createEl("div", {
				cls: "quick-switcher-item-title",
				text: result.title,
			});

			resultEl.createEl("div", {
				cls: "quick-switcher-item-summary",
				text: result.summary,
			});

			// Add a click event to create a note from the result
			resultEl.addEventListener("click", async () => {
				// Logic to create a note from result
				await this.createNoteFromResult(result);
			});

			// Support keyboard navigation
			resultEl.tabIndex = index;
			resultEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					// Logic to create a note from result
					this.createNoteFromResult(result);
				}
			});
		});
	}

	private async createNoteFromResult(result: {
		title: string;
		summary: string;
		url: string;
	}) {
		// check if the keyword folder exists
		const keywordFolder = "keyword";
		if (this.app.vault.getAbstractFileByPath(keywordFolder) === null) {
			await this.app.vault.createFolder(keywordFolder);
		}

		// check if the note already exists
		if (
			this.app.vault.getAbstractFileByPath(
				`keyword/${result.title}.md`
			) !== null
		) {
			new Notice(
				`Note already exists: ${result.title}`,
				NOTICE_MESSAGE_DURATION
			);
			// open the note
			let leaf = this.app.workspace.getLeaf("split", "vertical");
			if (!leaf) leaf = this.app.workspace.getLeaf();
			let fileToOpen = this.app.vault.getAbstractFileByPath(
				`keyword/${result.title}.md`
			);
			leaf.openFile(fileToOpen);
		} else {
			// Create a note with the result's title and summary
			const filePath = `keyword/${result.title}.md`;
			await this.app.vault.create(
				filePath,
				`${result.summary}\n\n[Read more on Wikipedia](${result.url})\n\n---\n\n`
			);
			new Notice(
				`Note created: ${result.title}`,
				NOTICE_MESSAGE_DURATION
			);
		}
		this.close();
	}
}
