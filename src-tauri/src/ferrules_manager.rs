use anyhow::{Context, Result};
use std::path::Path;
use std::process::Command;

pub struct FerrulesManager;

impl FerrulesManager {
    pub fn new() -> Self {
        FerrulesManager
    }

    /// Check if ferrules is available
    pub fn is_available(&self) -> bool {
        Command::new("ferrules")
            .arg("--version")
            .output()
            .is_ok()
    }

    /// Extract text from a PDF file using ferrules CLI
    pub fn extract_text(&self, pdf_path: &Path) -> Result<String> {
        eprintln!("Calling ferrules CLI for: {}", pdf_path.display());

        // Call ferrules to parse the PDF and output as markdown
        let output = Command::new("ferrules")
            .arg(pdf_path.to_str().ok_or_else(|| anyhow::anyhow!("Invalid path"))?)
            .arg("--md")  // Output as markdown for easier text extraction
            .output()
            .context("Failed to execute ferrules command")?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow::anyhow!("Ferrules failed: {}", stderr));
        }

        let text = String::from_utf8(output.stdout)
            .context("Failed to parse ferrules output as UTF-8")?;

        Ok(text)
    }
}
