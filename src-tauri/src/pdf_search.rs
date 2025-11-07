use anyhow::{Context, Result};
use lopdf::Document;
use rayon::prelude::*;
use regex::Regex;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZoteroMetadata {
    pub citekey: String,
    pub title: Option<String>,
    pub year: Option<String>,
    pub authors: Option<String>,
    pub zotero_link: String,
    pub pdf_attachment_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchMatch {
    pub file_path: String,
    pub file_name: String,
    pub page_number: usize,
    pub context_before: String,
    pub matched_text: String,
    pub context_after: String,
    pub zotero_link: Option<String>,
    pub zotero_metadata: Option<ZoteroMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryItem {
    pub query: String,
    pub use_regex: bool,
    #[serde(default = "default_query_type")]
    pub query_type: String, // "parallel" or "filter"
    #[serde(default = "default_color")]
    pub color: String, // hex color for highlighting
}

fn default_query_type() -> String {
    "parallel".to_string()
}

fn default_color() -> String {
    "#ffff00".to_string() // yellow default
}

#[derive(Debug, Deserialize)]
pub struct SearchParams {
    pub queries: Vec<QueryItem>,
    pub directory: String,
    pub context_words: usize,
    pub zotero_path: Option<String>,
}

pub fn find_pdf_files(directory: &Path) -> Result<Vec<PathBuf>> {
    let mut pdf_files = Vec::new();

    for entry in WalkDir::new(directory)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("pdf") {
            pdf_files.push(path.to_path_buf());
        }
    }

    Ok(pdf_files)
}

// Build a map of PDF filenames to Zotero metadata
fn build_zotero_map(zotero_path: &Path) -> Result<HashMap<String, ZoteroMetadata>> {
    let db_path = zotero_path.join("zotero.sqlite");
    let bbt_db_path = zotero_path.join("better-bibtex.sqlite");

    if !db_path.exists() {
        return Err(anyhow::anyhow!("Zotero database not found at {:?}", db_path));
    }

    // Create a temporary copy of the Zotero database to avoid file lock issues
    let temp_dir = std::env::temp_dir();
    let temp_db_path = temp_dir.join(format!("zotero_temp_{}.sqlite", std::process::id()));
    std::fs::copy(&db_path, &temp_db_path)
        .context("Failed to create temporary copy of Zotero database")?;

    let conn = Connection::open(&temp_db_path)
        .context("Failed to open Zotero database")?;

    // Open Better BibTeX database if it exists (also create temp copy)
    let (bbt_conn, temp_bbt_db_path) = if bbt_db_path.exists() {
        let temp_bbt_path = temp_dir.join(format!("better-bibtex_temp_{}.sqlite", std::process::id()));
        std::fs::copy(&bbt_db_path, &temp_bbt_path)
            .context("Failed to create temporary copy of Better BibTeX database")?;
        let conn = Connection::open(&temp_bbt_path)
            .context("Failed to open Better BibTeX database")?;
        (Some(conn), Some(temp_bbt_path))
    } else {
        (None, None)
    };

    // First, query to get basic item info and attachment paths
    // We need both the attachment item and the parent item
    let mut stmt = conn.prepare(
        "SELECT items.itemID, items.key, itemAttachments.path, itemAttachments.parentItemID, parent.key
         FROM items
         JOIN itemAttachments ON items.itemID = itemAttachments.itemID
         LEFT JOIN items AS parent ON itemAttachments.parentItemID = parent.itemID
         WHERE itemAttachments.path IS NOT NULL"
    )?;

    let mut map = HashMap::new();
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i32>(0)?,           // attachment itemID
            row.get::<_, String>(1)?,        // attachment key
            row.get::<_, String>(2)?,        // attachment path
            row.get::<_, Option<i32>>(3)?,   // parent itemID (null if no parent)
            row.get::<_, Option<String>>(4)?, // parent key (null if no parent)
        ))
    })?;

    for row in rows {
        if let Ok((attachment_id, attachment_key, path, parent_id, parent_key)) = row {
            // Extract filename from path (could be "storage:filename.pdf" or just "filename.pdf")
            let filename = if let Some(colon_pos) = path.rfind(':') {
                &path[colon_pos + 1..]
            } else {
                path.rsplit('/').next().unwrap_or(&path)
            };

            // Store attachment key for later use
            let pdf_attachment_key = attachment_key.clone();

            // Use parent item if available, otherwise use attachment item itself
            let (item_id, item_key) = if let (Some(pid), Some(pkey)) = (parent_id, parent_key) {
                (pid, pkey)
            } else {
                (attachment_id, attachment_key)
            };

            // Query for title, date, and creators from the parent item
            let title = get_item_field(&conn, item_id, "title").ok().flatten();
            let date = get_item_field(&conn, item_id, "date").ok().flatten();
            let year = extract_year(&date);
            let authors = get_item_creators(&conn, item_id).ok().flatten();

            // Try to get the BibTeX citation key from Better BibTeX database
            let bibtex_citekey = if let Some(ref bbt_conn) = bbt_conn {
                get_better_bibtex_citekey(bbt_conn, &item_key).ok().flatten()
            } else {
                None
            };
            let citekey = bibtex_citekey.unwrap_or_else(|| item_key.clone());

            map.insert(
                filename.to_string(),
                ZoteroMetadata {
                    citekey: citekey.clone(),
                    title,
                    year,
                    authors,
                    zotero_link: format!("zotero://select/library/items/{}", item_key),
                    pdf_attachment_key: Some(pdf_attachment_key),
                },
            );
        }
    }

    // Clean up temporary database files
    let _ = std::fs::remove_file(&temp_db_path);
    if let Some(temp_bbt_path) = temp_bbt_db_path {
        let _ = std::fs::remove_file(&temp_bbt_path);
    }

    Ok(map)
}

// Helper function to get item field value by field name
fn get_item_field(conn: &Connection, item_id: i32, field_name: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare(
        "SELECT itemDataValues.value
         FROM itemData
         JOIN fields ON itemData.fieldID = fields.fieldID
         JOIN itemDataValues ON itemData.valueID = itemDataValues.valueID
         WHERE itemData.itemID = ? AND fields.fieldName = ?"
    )?;

    let value = stmt.query_row([item_id.to_string(), field_name.to_string()], |row| {
        row.get::<_, String>(0)
    }).ok();

    Ok(value)
}

// Helper function to get item creators (authors)
fn get_item_creators(conn: &Connection, item_id: i32) -> Result<Option<String>> {
    let mut stmt = conn.prepare(
        "SELECT creators.firstName, creators.lastName
         FROM creators
         JOIN itemCreators ON creators.creatorID = itemCreators.creatorID
         WHERE itemCreators.itemID = ?
         ORDER BY itemCreators.orderIndex"
    )?;

    let mut creators = Vec::new();
    let rows = stmt.query_map([item_id], |row| {
        Ok((
            row.get::<_, Option<String>>(0)?,  // firstName (can be null)
            row.get::<_, Option<String>>(1)?,  // lastName
        ))
    })?;

    for row in rows {
        if let Ok((first_name, last_name)) = row {
            let name = match (first_name, last_name) {
                (Some(first), Some(last)) => format!("{} {}", first, last),
                (None, Some(last)) => last,
                (Some(first), None) => first,
                (None, None) => continue,
            };
            creators.push(name);
        }
    }

    if creators.is_empty() {
        Ok(None)
    } else {
        Ok(Some(creators.join(", ")))
    }
}

// Helper function to get Better BibTeX citation key
fn get_better_bibtex_citekey(conn: &Connection, item_key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare(
        "SELECT citationKey FROM citationkey WHERE itemKey = ?"
    )?;

    let citekey = stmt.query_row([item_key], |row| {
        row.get::<_, String>(0)
    }).ok();

    Ok(citekey)
}

// Helper function to extract year from date field
// Zotero dates can be in various formats like "2023-01-00 01/2023" or "2023"
fn extract_year(date: &Option<String>) -> Option<String> {
    if let Some(date_str) = date {
        // Try to find a 4-digit year
        for part in date_str.split(|c: char| !c.is_numeric()) {
            if part.len() == 4 {
                if let Ok(year) = part.parse::<i32>() {
                    if year >= 1000 && year <= 9999 {
                        return Some(year.to_string());
                    }
                }
            }
        }
    }
    None
}

fn extract_text_from_pdf(pdf_path: &Path) -> Result<Vec<(usize, String)>> {
    let doc = Document::load(pdf_path)
        .context(format!("Failed to load PDF: {}", pdf_path.display()))?;

    let mut pages = Vec::new();
    let page_count = doc.get_pages().len();

    for page_num in 1..=page_count {
        match doc.extract_text(&[page_num as u32]) {
            Ok(text) => {
                pages.push((page_num, text));
            }
            Err(_) => {
                // Skip pages that can't be extracted
                pages.push((page_num, String::new()));
            }
        }
    }

    Ok(pages)
}

fn split_into_words(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(|s| s.to_string())
        .collect()
}

/// Normalize text for searching by removing whitespace and common separators
/// This handles cases where PDFs don't have proper word spacing
fn normalize_text(text: &str) -> String {
    text.chars()
        .filter_map(|c| {
            match c {
                // Remove all whitespace
                ' ' | '\t' | '\n' | '\r' | '\u{00A0}' | '\u{2007}' | '\u{202F}' => None,
                // Remove hyphens and soft hyphens
                '-' | '\u{00AD}' | '\u{2010}' | '\u{2011}' => None,
                // Keep everything else
                _ => Some(c),
            }
        })
        .collect()
}

fn search_in_page(
    page_text: &str,
    query: &str,
    context_words: usize,
    use_regex: bool,
) -> Result<Vec<(String, String, String)>> {
    let mut matches = Vec::new();

    // Normalize both query and page text to handle PDFs with inconsistent spacing
    let normalized_query = normalize_text(query);
    let normalized_page = normalize_text(page_text);

    if use_regex {
        // Case-insensitive regex by default
        let pattern = Regex::new(&format!("(?i){}", normalized_query))?;

        for regex_match in pattern.find_iter(&normalized_page) {
            let match_start = regex_match.start();
            let match_end = regex_match.end();
            let matched_text = regex_match.as_str().to_string();

            let before_text = &normalized_page[..match_start];
            let after_text = &normalized_page[match_end..];

            let before_words: Vec<String> = split_into_words(before_text);
            let after_words: Vec<String> = split_into_words(after_text);

            let context_before = before_words
                .iter()
                .rev()
                .take(context_words)
                .rev()
                .cloned()
                .collect::<Vec<_>>()
                .join(" ");

            let context_after = after_words
                .iter()
                .take(context_words)
                .cloned()
                .collect::<Vec<_>>()
                .join(" ");

            matches.push((context_before, matched_text, context_after));
        }
    } else {
        // Case-insensitive search by default
        let search_query = normalized_query.to_lowercase();

        // Search the full normalized text instead of word-by-word
        // This catches multi-word queries that span across "words" in the original text
        let normalized_page_lower = normalized_page.to_lowercase();

        let mut search_start = 0;
        while let Some(match_pos) = normalized_page_lower[search_start..].find(&search_query) {
            let absolute_pos = search_start + match_pos;
            let match_end = absolute_pos + search_query.len();

            // Extract matched text from normalized page
            let matched_text = normalized_page[absolute_pos..match_end].to_string();

            // Get context from normalized text
            let before_text = &normalized_page[..absolute_pos];
            let after_text = &normalized_page[match_end..];

            let before_words: Vec<String> = split_into_words(before_text);
            let after_words: Vec<String> = split_into_words(after_text);

            let context_before = before_words
                .iter()
                .rev()
                .take(context_words)
                .rev()
                .cloned()
                .collect::<Vec<_>>()
                .join(" ");

            let context_after = after_words
                .iter()
                .take(context_words)
                .cloned()
                .collect::<Vec<_>>()
                .join(" ");

            matches.push((context_before, matched_text, context_after));

            // Move past this match to find the next one
            search_start = match_end;
        }
    }

    Ok(matches)
}

fn search_pdf_with_queries(
    pdf_path: &Path,
    queries: &[QueryItem],
    context_words: usize,
    zotero_map: Option<&HashMap<String, ZoteroMetadata>>,
) -> Result<Vec<SearchMatch>> {
    let pages = extract_text_from_pdf(pdf_path)?;

    // Get filename and lookup Zotero metadata if available
    let file_name = pdf_path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    let (zotero_link, zotero_metadata) = zotero_map
        .and_then(|map| map.get(&file_name))
        .map(|metadata| (
            Some(metadata.zotero_link.clone()),
            Some(metadata.clone()),
        ))
        .unwrap_or((None, None));

    // Separate queries into parallel and filter types
    let parallel_queries: Vec<&QueryItem> = queries.iter()
        .filter(|q| q.query_type == "parallel")
        .collect();
    let filter_queries: Vec<&QueryItem> = queries.iter()
        .filter(|q| q.query_type == "filter")
        .collect();

    // First, check if the PDF contains ALL filter queries (anywhere in the document)
    // Filter queries act as document-level filters
    for query_item in &filter_queries {
        let mut found_in_pdf = false;

        for (_page_num, page_text) in &pages {
            let matches = search_in_page(page_text, &query_item.query, context_words, query_item.use_regex)?;

            if !matches.is_empty() {
                found_in_pdf = true;
                break;
            }
        }

        if !found_in_pdf {
            // This PDF doesn't contain this filter query anywhere, so skip the entire PDF
            return Ok(Vec::new());
        }
    }

    // If we get here, the PDF passes all filters
    // Now collect matches from ALL parallel queries
    let mut final_results = Vec::new();

    // If there are no parallel queries, use the first query as parallel
    let queries_to_search: Vec<&QueryItem> = if parallel_queries.is_empty() && !queries.is_empty() {
        vec![&queries[0]]
    } else {
        parallel_queries
    };

    for query_item in queries_to_search {
        for (page_num, page_text) in &pages {
            let matches = search_in_page(page_text, &query_item.query, context_words, query_item.use_regex)?;

            for (context_before, matched_text, context_after) in matches {
                final_results.push(SearchMatch {
                    file_path: pdf_path.to_string_lossy().to_string(),
                    file_name: file_name.clone(),
                    page_number: *page_num,
                    context_before,
                    matched_text,
                    context_after,
                    zotero_link: zotero_link.clone(),
                    zotero_metadata: zotero_metadata.clone(),
                });
            }
        }
    }

    Ok(final_results)
}

pub fn search_pdfs(params: SearchParams) -> Result<Vec<SearchMatch>> {
    let directory = PathBuf::from(&params.directory);

    if params.queries.is_empty() {
        return Ok(Vec::new());
    }

    let pdf_files = find_pdf_files(&directory)?;

    if pdf_files.is_empty() {
        return Ok(Vec::new());
    }

    // Build Zotero map if path is provided
    let zotero_map = if let Some(ref zotero_path) = params.zotero_path {
        let path = PathBuf::from(zotero_path);
        match build_zotero_map(&path) {
            Ok(map) => Some(map),
            Err(e) => {
                eprintln!("Warning: Failed to load Zotero database: {}", e);
                None
            }
        }
    } else {
        None
    };

    // Search all PDFs in parallel, applying all queries to each PDF
    let all_matches: Vec<SearchMatch> = pdf_files
        .par_iter()
        .filter_map(|pdf_path| {
            match search_pdf_with_queries(
                pdf_path,
                &params.queries,
                params.context_words,
                zotero_map.as_ref(),
            ) {
                Ok(matches) => Some(matches),
                Err(_) => None,
            }
        })
        .flatten()
        .collect();

    Ok(all_matches)
}

pub fn export_to_markdown(matches: &[SearchMatch]) -> String {
    let mut markdown = String::from("# PDF Search Results\n\n");
    markdown.push_str(&format!("Total matches found: {}\n\n", matches.len()));

    let mut current_file = String::new();

    for (idx, m) in matches.iter().enumerate() {
        if m.file_path != current_file {
            current_file = m.file_path.clone();
            markdown.push_str(&format!("\n## File: `{}`\n", m.file_path));
            markdown.push_str(&format!("**Filename:** {}\n\n", m.file_name));
        }

        markdown.push_str(&format!("### Match {} (Page {})\n\n", idx + 1, m.page_number));
        markdown.push_str(&format!("**Page:** {}\n\n", m.page_number));
        markdown.push_str("**Context:**\n\n");
        markdown.push_str(&format!(
            "...{} **{}** {}...\n\n",
            m.context_before, m.matched_text, m.context_after
        ));
        markdown.push_str("---\n\n");
    }

    markdown
}
