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
    ReleaseDC, SelectObject, SetStretchBltMode, StretchBlt, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
    DIB_RGB_COLORS, HALFTONE, SRCCOPY,
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
    VK_CONTROL, VK_INSERT,
};

use crate::system::passport::WindowRect;

/// The captured user content prepared for the AI model.
///
/// Why:
/// Formulates the "Content" element of the Golden Context Triad:
/// Either raw highlighted text (lightweight and 100% accurate)
/// OR an optimized in-memory screenshot of the focused window.
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
        #[serde(default)]
        is_crop: bool,
    },
    /// Nothing was captured
    Empty,
}

/// Raw captured screen buffer extracted in 1-2 ms before the window opens.
pub struct RawScreenCapture {
    pub bgra_bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

/// Ultra-fast 1-2 ms hardware screen capture using GDI StretchBlt.
///
/// Why:
/// Downscales large 4K / 1440p displays to a maximum width of 1280px in GPU/DWM hardware,
/// reducing pixel memory by 4x to 8x and eliminating UI latency.
#[cfg(windows)]
pub fn fast_capture_raw_screen(rect: &WindowRect) -> Option<RawScreenCapture> {
    let orig_w = rect.width;
    let orig_h = rect.height;
    if orig_w <= 0 || orig_h <= 0 {
        return None;
    }

    // AI vision models (Gemini / Claude) do not need 4K uncompressed images.
    // Downscaling to max 1280px width preserves code readability while making capture instant.
    let (target_w, target_h) = if orig_w > 1280 {
        let scale = 1280.0 / orig_w as f32;
        (1280, (orig_h as f32 * scale).round() as i32)
    } else {
        (orig_w, orig_h)
    };

    unsafe {
        let hdc_screen = GetDC(None);
        if hdc_screen.0.is_null() {
            return None;
        }

        let hdc_mem = CreateCompatibleDC(Some(hdc_screen));
        if hdc_mem.0.is_null() {
            let _ = ReleaseDC(None, hdc_screen);
            return None;
        }

        let hbitmap = CreateCompatibleBitmap(hdc_screen, target_w, target_h);
        if hbitmap.0.is_null() {
            let _ = DeleteDC(hdc_mem);
            let _ = ReleaseDC(None, hdc_screen);
            return None;
        }

        let old_obj = SelectObject(hdc_mem, hbitmap.into());

        // High quality hardware antialiased downsampling via DWM/GDI in ~1 ms
        let _ = SetStretchBltMode(hdc_mem, HALFTONE);
        let blt_res = StretchBlt(
            hdc_mem,
            0,
            0,
            target_w,
            target_h,
            Some(hdc_screen),
            rect.left,
            rect.top,
            orig_w,
            orig_h,
            SRCCOPY,
        );

        if !blt_res.as_bool() {
            let _ = SelectObject(hdc_mem, old_obj);
            let _ = DeleteObject(hbitmap.into());
            let _ = DeleteDC(hdc_mem);
            let _ = ReleaseDC(None, hdc_screen);
            return None;
        }

        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: target_w,
                biHeight: -target_h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };

        let mut raw_pixels = vec![0u8; (target_w * target_h * 4) as usize];
        let lines = GetDIBits(
            hdc_mem,
            hbitmap,
            0,
            target_h as u32,
            Some(raw_pixels.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        // Immediately release all GDI handles to free system resources
        let _ = SelectObject(hdc_mem, old_obj);
        let _ = DeleteObject(hbitmap.into());
        let _ = DeleteDC(hdc_mem);
        let _ = ReleaseDC(None, hdc_screen);

        if lines == 0 {
            return None;
        }

        Some(RawScreenCapture {
            bgra_bytes: raw_pixels,
            width: target_w as u32,
            height: target_h as u32,
        })
    }
}

#[cfg(not(windows))]
pub fn fast_capture_raw_screen(_rect: &WindowRect) -> Option<RawScreenCapture> {
    None
}

/// Captures the full virtual screen (all monitors or primary) into RAM in 2-3 ms.
///
/// Why:
/// Executed immediately on Alt+F7 to freeze the display state before the snipping overlay appears.
#[cfg(windows)]
pub fn fast_capture_fullscreen() -> Option<RawScreenCapture> {
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{
            GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
            SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
        };

        let mut left = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let mut top = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let mut width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let mut height = GetSystemMetrics(SM_CYVIRTUALSCREEN);

        if width <= 0 || height <= 0 {
            left = 0;
            top = 0;
            width = GetSystemMetrics(SM_CXSCREEN);
            height = GetSystemMetrics(SM_CYSCREEN);
        }

        let hdc_screen = GetDC(None);
        if hdc_screen.0.is_null() {
            return None;
        }

        let hdc_mem = CreateCompatibleDC(Some(hdc_screen));
        if hdc_mem.0.is_null() {
            let _ = ReleaseDC(None, hdc_screen);
            return None;
        }

        let hbitmap = CreateCompatibleBitmap(hdc_screen, width, height);
        if hbitmap.0.is_null() {
            let _ = DeleteDC(hdc_mem);
            let _ = ReleaseDC(None, hdc_screen);
            return None;
        }

        let old_obj = SelectObject(hdc_mem, hbitmap.into());

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

        let _ = SelectObject(hdc_mem, old_obj);
        let _ = DeleteObject(hbitmap.into());
        let _ = DeleteDC(hdc_mem);
        let _ = ReleaseDC(None, hdc_screen);

        if lines == 0 {
            return None;
        }

        Some(RawScreenCapture {
            bgra_bytes: raw_pixels,
            width: width as u32,
            height: height as u32,
        })
    }
}

#[cfg(not(windows))]
pub fn fast_capture_fullscreen() -> Option<RawScreenCapture> {
    None
}

/// Crops a sub-rectangle from a raw BGRA in-memory screen capture in < 0.1 ms.
pub fn crop_raw_screen(
    capture: &RawScreenCapture,
    crop_x: u32,
    crop_y: u32,
    crop_w: u32,
    crop_h: u32,
) -> Option<RawScreenCapture> {
    if crop_w == 0 || crop_h == 0 {
        return None;
    }

    let src_w = capture.width;
    let src_h = capture.height;

    if crop_x >= src_w || crop_y >= src_h {
        return None;
    }

    let actual_w = crop_w.min(src_w - crop_x);
    let actual_h = crop_h.min(src_h - crop_y);

    let mut cropped_bgra = Vec::with_capacity((actual_w * actual_h * 4) as usize);

    for row in 0..actual_h {
        let y = crop_y + row;
        let start_idx = ((y * src_w + crop_x) * 4) as usize;
        let end_idx = start_idx + (actual_w * 4) as usize;
        if end_idx <= capture.bgra_bytes.len() {
            cropped_bgra.extend_from_slice(&capture.bgra_bytes[start_idx..end_idx]);
        }
    }

    Some(RawScreenCapture {
        bgra_bytes: cropped_bgra,
        width: actual_w,
        height: actual_h,
    })
}

/// Dispatches an asynchronous Ctrl+Insert copy command without sleeping.
///
/// Returns the clipboard sequence number prior to the command.
#[cfg(windows)]
pub fn dispatch_safe_copy() -> u32 {
    unsafe {
        let seq = GetClipboardSequenceNumber();
        let inputs = [
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
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_INSERT,
                        wScan: 0,
                        dwFlags: KEYBD_EVENT_FLAGS(0),
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VK_INSERT,
                        wScan: 0,
                        dwFlags: KEYEVENTF_KEYUP,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            },
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
        seq
    }
}

#[cfg(not(windows))]
pub fn dispatch_safe_copy() -> u32 {
    0
}

/// Reads current UTF-16 text from the Windows system clipboard if available.
#[cfg(windows)]
pub fn read_clipboard_text() -> Option<String> {
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

#[cfg(not(windows))]
pub fn read_clipboard_text() -> Option<String> {
    None
}

/// Converts raw BGRA pixels to compressed JPEG Data URL in RAM.
pub fn encode_jpeg_base64(raw_bgra: &[u8], width: u32, height: u32) -> Option<String> {
    let mut rgb_pixels = Vec::with_capacity((width * height * 3) as usize);
    let (chunks, _) = raw_bgra.as_chunks::<4>();
    for chunk in chunks {
        rgb_pixels.push(chunk[2]); // R
        rgb_pixels.push(chunk[1]); // G
        rgb_pixels.push(chunk[0]); // B
    }

    let mut jpeg_bytes = Cursor::new(Vec::new());
    let mut encoder = JpegEncoder::new_with_quality(&mut jpeg_bytes, 80);
    if encoder
        .encode(&rgb_pixels, width, height, ExtendedColorType::Rgb8)
        .is_ok()
    {
        let base64_str = BASE64.encode(jpeg_bytes.into_inner());
        Some(format!("data:image/jpeg;base64,{}", base64_str))
    } else {
        None
    }
}

/// Finalizes context capture in a background worker thread.
///
/// Why:
/// Runs asynchronously while the user sees the window open instantly.
/// - If `force_screenshot` is true (triggered via Alt+F7): directly encodes and returns the window screenshot.
/// - If `force_screenshot` is false (triggered via F7): auto-detects highlighted text first; if none, falls back to screenshot.
pub fn finalize_capture(
    raw_screen: Option<RawScreenCapture>,
    seq_before: u32,
    force_screenshot: bool,
) -> CapturedContent {
    // 1. If user explicitly pressed Alt+F7 (force screenshot), skip text capture entirely!
    if force_screenshot {
        if let Some(screen) = raw_screen {
            if let Some(base64) = encode_jpeg_base64(&screen.bgra_bytes, screen.width, screen.height) {
                return CapturedContent::Screenshot {
                    base64,
                    width: screen.width,
                    height: screen.height,
                    is_crop: false,
                };
            }
        }
        return CapturedContent::Empty;
    }

    // 2. Standard F7: Auto-detection
    // Give target app message queue ~25 ms to complete copy
    std::thread::sleep(std::time::Duration::from_millis(25));

    #[cfg(windows)]
    {
        let seq_after = unsafe { GetClipboardSequenceNumber() };
        if seq_after != seq_before {
            if let Some(text) = read_clipboard_text() {
                return CapturedContent::Text(text);
            }
        }
    }

    // 3. Fallback to optimized in-memory screenshot if no text was highlighted
    if let Some(screen) = raw_screen {
        if let Some(base64) = encode_jpeg_base64(&screen.bgra_bytes, screen.width, screen.height) {
            return CapturedContent::Screenshot {
                base64,
                width: screen.width,
                height: screen.height,
                is_crop: false,
            };
        }
    }

    CapturedContent::Empty
}
