// menu_symbols.rs — puts SF Symbols on the installed macOS menu bar.
//
// Tauri's menu API only takes AppKit's old template images (NativeIcon), which
// have nothing for most rows. After the frontend installs its menu
// (AppMenu.tsx), it sends each row's title and SF Symbol name; this walks
// NSApp.mainMenu and sets `[NSImage imageWithSystemSymbolName:]` on the rows
// whose title matches. SF Symbols are templates, so they tint with light and
// dark mode, and the image slot exists on checkmark rows too. A name macOS
// does not know leaves that row without an icon. Elsewhere it does nothing.

#[tauri::command]
pub fn set_menu_symbols(app: tauri::AppHandle, symbols: Vec<(String, String)>) -> Result<(), String> {
    // AppKit menus may only be touched on the main thread.
    #[cfg(target_os = "macos")]
    app.run_on_main_thread(move || unsafe { macos::apply(&symbols) })
        .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let _ = (app, symbols);
    Ok(())
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use std::ffi::{c_char, CStr, CString};

    pub unsafe fn apply(symbols: &[(String, String)]) {
        let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let menu: *mut AnyObject = msg_send![app, mainMenu];
        if !menu.is_null() {
            walk(menu, symbols);
        }
    }

    unsafe fn walk(menu: *mut AnyObject, symbols: &[(String, String)]) {
        let items: *mut AnyObject = msg_send![menu, itemArray];
        let count: usize = msg_send![items, count];
        for i in 0..count {
            let item: *mut AnyObject = msg_send![items, objectAtIndex: i];
            let title: *mut AnyObject = msg_send![item, title];
            let utf8: *const c_char = msg_send![title, UTF8String];
            let title = if utf8.is_null() { None } else { CStr::from_ptr(utf8).to_str().ok() };
            if let Some((_, name)) = title.and_then(|t| symbols.iter().find(|(s, _)| s == t)) {
                let name = CString::new(name.as_str()).unwrap_or_default();
                let name: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: name.as_ptr()];
                let none: *mut AnyObject = std::ptr::null_mut();
                let image: *mut AnyObject =
                    msg_send![class!(NSImage), imageWithSystemSymbolName: name, accessibilityDescription: none];
                if !image.is_null() {
                    let _: () = msg_send![item, setImage: image];
                }
            }
            let submenu: *mut AnyObject = msg_send![item, submenu];
            if !submenu.is_null() {
                walk(submenu, symbols);
            }
        }
    }
}
