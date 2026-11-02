use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use image::codecs::jpeg::JpegEncoder;
use image::ExtendedColorType;
use serde::{Deserialize, Serialize};
use std::io::Cursor;

#[cfg(windows)]
use windows::Win32::Foundation::HGLOBAL;
#[cfg(windows)]
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetDC,
    ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, SRCCOPY,
};
#[cfg(windows)]
use windows::Win32::System::DataExchange::{
    CloseClipboard, GetClipboardData, GetClipboardSequenceNumber, OpenClipboard,
};
#[cfg(windows)]
use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};
#[cfg(windows)]
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
    VK_C, VK_CONTROL,
};

use crate::system::passport::WindowPassport;

/// The captured user content prepared for the AI model.
///
/// Why:
/// Formulates the "Content" element of the Golden Context Triad:
/// Either raw highlighted text (lightweight and 100% accurate)
/// OR a pixel-perfect in-memory screenshot of the focused window.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum CapturedContent {
    /// Pure text highlighted by user prior to hotkey
    Text(String),
    /// In-memory JPEG screenshot in data URL base64 format
    Screenshot {
        base64: String,
        width: u32,
        height: u32,
    },
    /// Nothing was captured
    Empty,
}

/// Captures a screen rectangle using Win32 GDI BitBlt and compresses it to JPEG in RAM.
///
/// Why:
/// Uses the desktop DC (GetDC(None)) to capture the hardware-accelerated DWM composition
/// of modern apps (VS Code, Chrome, etc.) avoiding the dreaded "black screen" bug.
#[cfg(windows)]
pub fn capture_rect_screenshot(
    left: i32,
    top: i32,
    width: i32,
    height: i32,
) -> Option<(String, u32, u32)> {
    if width <= 0 || height <= 0 {
        return None;
    }

    unsafe {
        // Step 1: Query the Desktop Device Context (contains all composited GPU surfaces)
        let hdc_screen = GetDC(None);
        if hdc_screen.0.is_null() {
            return None;
        }

        let hdc_mem = CreateCompatibleDC(Some(hdc_screen));
        if hdc_mem.0.is_null() {
            let _ = ReleaseDC(None, hdc_screen);
            return None;
        }

        // Step 2: Create a compatible memory bitmap matching target window bounds
        let hbitmap = CreateCompatibleBitmap(hdc_screen, width, height);
        if hbitmap.0.is_null() {
            let _ = DeleteDC(hdc_mem);
            let _ = ReleaseDC(None, hdc_screen);
            return None;
        }

        let old_obj = SelectObject(hdc_mem, hbitmap.into());

        // Step 3: Fast 2 ms hardware block transfer from screen DC to memory DC
        let blt_res = BitBlt(
            hdc_mem,
            0,
            0,
            width,
            height,
            Some(hdc_screen),
            left,
            top,
            SRCCOPY,
        );

        if blt_res.is_err() {
            let _ = SelectObject(hdc_mem, old_obj);
            let _ = DeleteObject(hbitmap.into());
            let _ = DeleteDC(hdc_mem);
            let _ = ReleaseDC(None, hdc_screen);
            return None;
        }

        // Step 4: Extract raw BGRA pixels using GetDIBits with negative height for top-down layout
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };

        let mut raw_pixels = vec![0u8; (width * height * 4) as usize];
        let lines = GetDIBits(
            hdc_mem,
            hbitmap,
            0,
            height as u32,
            Some(raw_pixels.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        // Cleanup GDI objects immediately to prevent resource leakage
        let _ = SelectObject(hdc_mem, old_obj);
        let _ = DeleteObject(hbitmap.into());
        let _ = DeleteDC(hdc_mem);
        let _ = ReleaseDC(None, hdc_screen);

        if lines == 0 {
            return None;
        }

        // Step 5: Convert Windows BGRA to standard RGB for JPEG encoding
        let mut rgb_pixels = Vec::with_capacity((width * height * 3) as usize);
        for chunk in raw_pixels.chunks_exact(4) {
            rgb_pixels.push(chunk[2]); // R
            rgb_pixels.push(chunk[1]); // G
            rgb_pixels.push(chunk[0]); // B
        }

        // Step 6: Compress into JPEG in memory (Quality 80: ~150KB, ~10ms encoding)
        let mut jpeg_bytes = Cursor::new(Vec::new());
        let mut encoder = JpegEncoder::new_with_quality(&mut jpeg_bytes, 80);
        if encoder
            .encode(
                &rgb_pixels,
                width as u32,
                height as u32,
                ExtendedColorType::Rgb8,
            )
            .is_ok()
        {
            let base64_str = BASE64.encode(jpeg_bytes.into_inner());
            let data_url = format!("data:image/jpeg;base64,{}", base64_str);
            Some((data_url, width as u32, height as u32))
        } else {
            None
        }
    }
}

/// Fallback for non-Windows platforms.
#[cfg(not(windows))]
pub fn capture_rect_screenshot(
    _left: i32,
    _top: i32,
    _width: i32,
    _height: i32,
) -> Option<(String, u32, u32)> {
    None
}

/// Reads current UTF-16 text from the Windows system clipboard if available.
#[cfg(windows)]
fn read_clipboard_text() -> Option<String> {
    unsafe {
        if OpenClipboard(None).is_ok() {
            // CF_UNICODETEXT = 13
            if let Ok(handle) = GetClipboardData(13) {
                if !handle.0.is_null() {
                    let ptr = GlobalLock(HGLOBAL(handle.0));
                    if !ptr.is_null() {
                        let mut len = 0;
                        let mut p = ptr as *const u16;
                        while *p != 0 {
                            len += 1;
                            p = p.add(1);
                        }
                        let slice = std::slice::from_raw_parts(ptr as *const u16, len);
                        let text = String::from_utf16_lossy(slice);
                        let _ = GlobalUnlock(HGLOBAL(handle.0));
                        let _ = CloseClipboard();

                        let trimmed = text.trim().to_string();
                        if !trimmed.is_empty() {
                            return Some(trimmed);
                        }
                        return None;
                    }
                }
            }
            let _ = CloseClipboard();
        }
        None
    }
}

/// Attempts to capture highlighted text from the active foreground window.
///
/// Why:
/// Uses the battle-tested GoldenDict/Text-Grab pattern: checks GetClipboardSequenceNumber,
/// pulses SendInput(Ctrl+C), and checks if the sequence counter increased.
#[cfg(windows)]
pub fn try_capture_selected_text() -> Option<String> {
    unsafe {
        let seq_before = GetClipboardSequenceNumber();

        // Synthesize Ctrl+C key combination
        let inputs = [
            // Ctrl down
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_CONTROL,
                        wScan: 0,
                        dwFlags: KEYBD_EVENT_FLAGS(0),
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            // C down
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_C,
                        wScan: 0,
                        dwFlags: KEYBD_EVENT_FLAGS(0),
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            // C up
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_C,
                        wScan: 0,
                        dwFlags: KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            // Ctrl up
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_CONTROL,
                        wScan: 0,
                        dwFlags: KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
        ];

        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);

        // Sleep 35 ms allowing Electron/browser/IDE message pump to process Ctrl+C
        std::thread::sleep(std::time::Duration::from_millis(35));

        let seq_after = GetClipboardSequenceNumber();
        if seq_after != seq_before {
            read_clipboard_text()
        } else {
            None
        }
    }
}

/// Fallback for non-Windows platforms.
#[cfg(not(windows))]
pub fn try_capture_selected_text() -> Option<String> {
    None
}

/// Unified context capture function.
///
/// Why:
/// Evaluates whether text was highlighted; if so, returns text immediately.
/// If no text was highlighted, falls back to a sub-millisecond BitBlt screenshot of the window.
pub fn capture_active_content(passport: &Option<WindowPassport>) -> CapturedContent {
    // 1. Try highlighted text first
    if let Some(text) = try_capture_selected_text() {
        return CapturedContent::Text(text);
    }

    // 2. Fallback to window screenshot if passport bounds are available
    if let Some(ref p) = passport {
        if p.rect.width > 0 && p.rect.height > 0 {
            if let Some((base64, width, height)) =
                capture_rect_screenshot(p.rect.left, p.rect.top, p.rect.width, p.rect.height)
            {
                return CapturedContent::Screenshot {
                    base64,
                    width,
                    height,
                };
            }
        }
    }

    CapturedContent::Empty
}
