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

#[derive(Debug, Deserialize)]
pub struct SearchParams {
    pub query: String,
    pub directory: String,
    pub context_words: usize,
    pub case_sensitive: bool,
    pub use_regex: bool,
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

    if !db_path.exists() {
        return Err(anyhow::anyhow!("Zotero database not found at {:?}", db_path));
    }

    let conn = Connection::open(&db_path)
        .context("Failed to open Zotero database")?;

    // First, query to get basic item info and attachment paths
    let mut stmt = conn.prepare(
        "SELECT items.itemID, items.key, itemAttachments.path
         FROM items
         JOIN itemAttachments ON items.itemID = itemAttachments.itemID
         WHERE itemAttachments.path IS NOT NULL"
    )?;

    let mut map = HashMap::new();
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i32>(0)?,      // itemID
            row.get::<_, String>(1)?,   // item key (citekey)
            row.get::<_, String>(2)?,   // attachment path
        ))
    })?;

    for row in rows {
        if let Ok((item_id, item_key, path)) = row {
            // Extract filename from path (could be "storage:filename.pdf" or just "filename.pdf")
            let filename = if let Some(colon_pos) = path.rfind(':') {
                &path[colon_pos + 1..]
            } else {
                path.rsplit('/').next().unwrap_or(&path)
            };

            // Query for title, year, and creators
            let title = get_item_field(&conn, item_id, "title").ok().flatten();
            let year = get_item_field(&conn, item_id, "year").ok().flatten();
            let authors = get_item_creators(&conn, item_id).ok().flatten();

            // Try to get the BibTeX citation key from the extra field
            let bibtex_citekey = extract_bibtex_citekey(
                &get_item_field(&conn, item_id, "extra").ok().flatten()
            );
            let citekey = bibtex_citekey.unwrap_or_else(|| item_key.clone());

            map.insert(
                filename.to_string(),
                ZoteroMetadata {
                    citekey: citekey.clone(),
                    title,
                    year,
                    authors,
                    zotero_link: format!("zotero://select/library/items/{}", item_key),
                },
            );
        }
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
        "SELECT creators.name
         FROM creators
         JOIN itemCreators ON creators.creatorID = itemCreators.creatorID
         WHERE itemCreators.itemID = ?
         ORDER BY itemCreators.orderIndex"
    )?;

    let mut creators = Vec::new();
    let rows = stmt.query_map([item_id], |row| {
        row.get::<_, String>(0)
    })?;

    for row in rows {
        if let Ok(creator) = row {
            creators.push(creator);
        }
    }

    if creators.is_empty() {
        Ok(None)
    } else {
        Ok(Some(creators.join(", ")))
    }
}

// Helper function to extract BibTeX citation key from the extra field
// Zotero stores citation keys in the format: "Citation Key: coraiola2023"
fn extract_bibtex_citekey(extra: &Option<String>) -> Option<String> {
    if let Some(extra_text) = extra {
        // Look for "Citation Key: " pattern (case-insensitive)
        if let Some(start_pos) = extra_text.to_lowercase().find("citation key:") {
            let after_label = &extra_text[start_pos + 13..]; // Skip past "citation key:"
            let key = after_label.trim().split_whitespace().next()?;
            if !key.is_empty() {
                return Some(key.to_string());
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

fn search_in_page(
    page_text: &str,
    query: &str,
    context_words: usize,
    case_sensitive: bool,
    use_regex: bool,
) -> Result<Vec<(String, String, String)>> {
    let mut matches = Vec::new();
    let words = split_into_words(page_text);

    // Remove spaces from query to handle multi-word searches in PDFs without spaces
    let query_no_spaces = query.replace(" ", "");

    if use_regex {
        let pattern = if case_sensitive {
            Regex::new(&query_no_spaces)?
        } else {
            Regex::new(&format!("(?i){}", query_no_spaces))?
        };

        // Create a version of page_text without spaces for matching
        let page_text_no_spaces = page_text.replace(" ", "");

        for regex_match in pattern.find_iter(&page_text_no_spaces) {
            let match_start = regex_match.start();
            let match_end = regex_match.end();
            let matched_text = regex_match.as_str().to_string();

            let before_text = &page_text_no_spaces[..match_start];
            let after_text = &page_text_no_spaces[match_end..];

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
        let search_query = if case_sensitive {
            query_no_spaces.clone()
        } else {
            query_no_spaces.to_lowercase()
        };

        for (i, word) in words.iter().enumerate() {
            let compare_word = if case_sensitive {
                word.clone()
            } else {
                word.to_lowercase()
            };

            if compare_word.contains(&search_query) {
                let start = i.saturating_sub(context_words);
                let end = (i + context_words + 1).min(words.len());

                let context_before = words[start..i].join(" ");
                let matched_text = word.clone();
                let context_after = words[(i + 1)..end].join(" ");

                matches.push((context_before, matched_text, context_after));
            }
        }
    }

    Ok(matches)
}

fn search_pdf(
    pdf_path: &Path,
    query: &str,
    context_words: usize,
    case_sensitive: bool,
    use_regex: bool,
    zotero_map: Option<&HashMap<String, ZoteroMetadata>>,
) -> Result<Vec<SearchMatch>> {
    let pages = extract_text_from_pdf(pdf_path)?;
    let mut results = Vec::new();

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

    for (page_num, page_text) in pages {
        let matches = search_in_page(&page_text, query, context_words, case_sensitive, use_regex)?;

        for (context_before, matched_text, context_after) in matches {
            results.push(SearchMatch {
                file_path: pdf_path.to_string_lossy().to_string(),
                file_name: file_name.clone(),
                page_number: page_num,
                context_before,
                matched_text,
                context_after,
                zotero_link: zotero_link.clone(),
                zotero_metadata: zotero_metadata.clone(),
            });
        }
    }

    Ok(results)
}

pub fn search_pdfs(params: SearchParams) -> Result<Vec<SearchMatch>> {
    let directory = PathBuf::from(&params.directory);
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

    // Search all PDFs in parallel
    let all_matches: Vec<SearchMatch> = pdf_files
        .par_iter()
        .filter_map(|pdf_path| {
            match search_pdf(
                pdf_path,
                &params.query,
                params.context_words,
                params.case_sensitive,
                params.use_regex,
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
