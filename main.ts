import { App, Plugin, Modal, Notice } from "obsidian";

const fetch = (...args) =>
	import("node-fetch").then(({ default: fetch }) => fetch(...args));

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
async function searchWikipedia(searchTerm: string) {
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
		new Notice(`Found ${summaries.length} results.`);
		return summaries; // Returns an array of objects with trueTitle, summary, and trueUrl
	} catch (error) {
		console.error("Error searching Wikipedia:", error);
		new Notice(`Error searching Wikipedia.`);
		return [];
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
							//new Notice(`Found ${results.length} results.`)
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
			new Notice(`Note already exists: ${result.title}`);
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
			new Notice(`Note created: ${result.title}`);
		}
		this.close();
	}
}
