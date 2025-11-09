import type { SearchMatch, PinnedResult, Note } from './types';

// Current search results
export let currentResults: SearchMatch[] = [];

// Store per-PDF search queries (filePath -> query string)
export const perPdfSearchQueries = new Map<string, string>();

// Store pinned results (filePath -> {queries, matches})
export const pinnedResults = new Map<string, PinnedResult>();

// Notes feature
export const notes: Note[] = [];

// DOM Elements
export let searchForm: HTMLFormElement;
export let searchQueriesContainer: HTMLElement;
export let addSearchTermBtn: HTMLAnchorElement;
export let addFilterTermBtn: HTMLAnchorElement;
export let directoryPath: HTMLElement;
export let browseBtn: HTMLButtonElement;
export let zoteroMode: HTMLInputElement;
export let zoteroPath: HTMLElement;
export let browseZoteroBtn: HTMLButtonElement;
export let zoteroFolderGroup: HTMLElement;
export let searchBtn: HTMLButtonElement;
export let exportLink: HTMLAnchorElement;
export let statusMessage: HTMLElement;
export let resultsCount: HTMLElement;
export let resultsContainer: HTMLElement;
export let toggleNotesBtn: HTMLButtonElement;
export let notesSidebar: HTMLElement;
export let notesList: HTMLElement;
export let exportNotesBtn: HTMLAnchorElement;
export let clearNotesBtn: HTMLAnchorElement;

export let queryCount = 1;

// Function to set currentResults (since it's exported with let, we need a setter)
export function setCurrentResults(results: SearchMatch[]) {
  currentResults = results;
}

// Function to initialize DOM elements
export function initializeDomElements() {
  searchForm = document.querySelector("#search-form")!;
  searchQueriesContainer = document.querySelector("#search-queries-container")!;
  addSearchTermBtn = document.querySelector("#add-search-term")!;
  addFilterTermBtn = document.querySelector("#add-filter-term")!;
  directoryPath = document.querySelector("#directory-path")!;
  browseBtn = document.querySelector("#browse-btn")!;
  zoteroMode = document.querySelector("#zotero-mode")!;
  zoteroPath = document.querySelector("#zotero-path")!;
  browseZoteroBtn = document.querySelector("#browse-zotero-btn")!;
  zoteroFolderGroup = document.querySelector("#zotero-folder-group")!;
  searchBtn = document.querySelector("#search-btn")!;
  exportLink = document.querySelector("#export-link")!;
  statusMessage = document.querySelector("#status-message")!;
  resultsCount = document.querySelector("#results-count")!;
  resultsContainer = document.querySelector("#results-container")!;
  toggleNotesBtn = document.querySelector("#toggle-notes-btn")!;
  notesSidebar = document.querySelector(".notes-sidebar")!;
  notesList = document.querySelector("#notes-list")!;
  exportNotesBtn = document.querySelector("#export-notes-btn")!;
  clearNotesBtn = document.querySelector("#clear-notes-btn")!;
}

// Function to increment and get queryCount
export function incrementQueryCount(): number {
  return queryCount++;
}
