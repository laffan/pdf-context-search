mod pdf_search;

use pdf_search::{export_to_markdown, search_pdfs, search_single_pdf, list_pdfs, SearchMatch, SearchParams, PdfListItem, ListPdfsParams};
use std::fs;

#[tauri::command]
fn search_pdf_files(params: SearchParams) -> Result<Vec<SearchMatch>, String> {
    search_pdfs(params).map_err(|e| e.to_string())
}

#[tauri::command]
fn search_single_pdf_file(params: SearchParams) -> Result<Vec<SearchMatch>, String> {
    search_single_pdf(params).map_err(|e| e.to_string())
}

#[tauri::command]
fn export_results_to_markdown(matches: Vec<SearchMatch>, output_path: String) -> Result<(), String> {
    let markdown = export_to_markdown(&matches);
    fs::write(&output_path, markdown).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_pdf_file(file_path: String) -> Result<Vec<u8>, String> {
    fs::read(&file_path).map_err(|e| format!("Failed to read PDF file: {}", e))
}

#[tauri::command]
fn list_pdf_files(params: ListPdfsParams) -> Result<Vec<PdfListItem>, String> {
    list_pdfs(params).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            search_pdf_files,
            search_single_pdf_file,
            export_results_to_markdown,
            read_pdf_file,
            list_pdf_files
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
