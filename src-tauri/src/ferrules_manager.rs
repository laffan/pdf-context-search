use anyhow::{Context, Result};
use std::process::{Child, Command};
use std::thread;
use std::time::Duration;

pub struct FerrulesManager {
    process: Option<Child>,
}

impl FerrulesManager {
    pub fn new() -> Self {
        FerrulesManager { process: None }
    }

    pub fn start(&mut self) -> Result<()> {
        eprintln!("Starting ferrules server...");

        // Try to start ferrules from the bundled binary or system PATH
        let child = Command::new("ferrules")
            .arg("--port")
            .arg("3002")
            .spawn()
            .context("Failed to start ferrules. Make sure ferrules binary is available.")?;

        self.process = Some(child);

        // Wait a bit for ferrules to start up
        eprintln!("Waiting for ferrules to initialize...");
        thread::sleep(Duration::from_secs(2));

        // Test connection
        match reqwest::blocking::get("http://localhost:3002/health") {
            Ok(_) => {
                eprintln!("Ferrules server started successfully on port 3002");
                Ok(())
            }
            Err(e) => {
                eprintln!("Warning: Ferrules may not be ready yet: {}", e);
                Ok(())  // Don't fail, just warn
            }
        }
    }

    pub fn stop(&mut self) {
        if let Some(mut child) = self.process.take() {
            eprintln!("Stopping ferrules server...");
            let _ = child.kill();
            let _ = child.wait();
            eprintln!("Ferrules server stopped");
        }
    }
}

impl Drop for FerrulesManager {
    fn drop(&mut self) {
        self.stop();
    }
}
