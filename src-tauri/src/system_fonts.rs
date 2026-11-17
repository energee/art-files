// system_fonts.rs — the installed fonts the desktop Font menu offers to
// import. Lists single-font, upright .ttf/.otf files only, and remembers the
// listed paths so read_system_font (next) can refuse any other file.

use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{Mutex, PoisonError},
};

/** One installed face, as the webview sees it. */
#[derive(serde::Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SystemFont {
    pub family: String,
    pub postscript: String,
    pub weight: u16,
    pub path: String,
}

/** What the filter needs from one scanned face — fontdb's FaceInfo cut down
 * to plain data so tests can build fixtures without a real font directory. */
pub struct ScannedFace {
    pub family: String,
    pub postscript: String,
    pub weight: u16,
    pub italic: bool,
    pub path: PathBuf,
    /** Face index inside the file; non-zero only in a collection. */
    pub index: u32,
}

/** Paths the last list_system_fonts returned, canonicalised (dunce): the
 * only files read_system_font may open. Replaced on every listing. */
#[derive(Default)]
pub struct SystemFontPaths(pub Mutex<HashSet<PathBuf>>);

/** Keep the faces the Font menu can import, sorted by family, weight, then
 * PostScript name. Dropped: collections (.ttc/.otc, or any face past index 0,
 * because pdf-lib embeds one font per file), any other format than
 * .ttf/.otf, italics (labels use upright faces), and a path that cannot be a
 * String (the webview hands it back to read_system_font verbatim). */
pub fn listable_fonts(faces: impl IntoIterator<Item = ScannedFace>) -> Vec<SystemFont> {
    let mut fonts: Vec<SystemFont> = faces
        .into_iter()
        .filter(|face| face.index == 0 && !face.italic && is_single_font_file(&face.path))
        .filter_map(|face| {
            Some(SystemFont {
                path: face.path.into_os_string().into_string().ok()?,
                family: face.family,
                postscript: face.postscript,
                weight: face.weight,
            })
        })
        .collect();
    fonts.sort_by(|a, b| {
        (&a.family, a.weight, &a.postscript).cmp(&(&b.family, b.weight, &b.postscript))
    });
    fonts
}

fn is_single_font_file(path: &Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("ttf") || ext.eq_ignore_ascii_case("otf"))
}

/** Every face in the OS font directories, judged by its canonical path so a
 * symlinked font is listed (and later allowed) as its real file. */
fn scan_system_faces() -> Vec<ScannedFace> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    db.faces()
        .filter_map(|face| {
            let fontdb::Source::File(path) = &face.source else {
                return None;
            };
            Some(ScannedFace {
                family: face.families.first()?.0.clone(),
                postscript: face.post_script_name.clone(),
                weight: face.weight.0,
                italic: face.style != fontdb::Style::Normal,
                path: dunce::canonicalize(path).unwrap_or_else(|_| path.clone()),
                index: face.index,
            })
        })
        .collect()
}

/** List the installed fonts the Font menu can import, and remember their
 * paths for read_system_font. Runs off the main thread (`async`): a cold
 * scan of the font directories can take a moment. */
#[tauri::command(async)]
pub fn list_system_fonts(state: tauri::State<'_, SystemFontPaths>) -> Vec<SystemFont> {
    let fonts = listable_fonts(scan_system_faces());
    *state.0.lock().unwrap_or_else(PoisonError::into_inner) =
        fonts.iter().map(|font| PathBuf::from(&font.path)).collect();
    fonts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn face(family: &str, weight: u16, path: &str) -> ScannedFace {
        ScannedFace {
            family: family.into(),
            postscript: format!("{family}-{weight}"),
            weight,
            italic: false,
            path: PathBuf::from(path),
            index: 0,
        }
    }

    fn paths(fonts: &[SystemFont]) -> Vec<&str> {
        fonts.iter().map(|f| f.path.as_str()).collect()
    }

    #[test]
    fn keeps_only_single_font_ttf_and_otf_files() {
        let fonts = listable_fonts([
            face("A", 400, "/f/a.ttf"),
            face("B", 400, "/f/b.otf"),
            face("C", 400, "/f/c.ttc"),
            face("D", 400, "/f/d.otc"),
            face("E", 400, "/f/e.woff2"),
            face("F", 400, "/f/noext"),
        ]);
        assert_eq!(paths(&fonts), ["/f/a.ttf", "/f/b.otf"]);
    }

    #[test]
    fn drops_faces_past_index_zero() {
        let mut second = face("A", 700, "/f/a.ttf");
        second.index = 1;
        assert!(listable_fonts([second]).is_empty());
    }

    #[test]
    fn matches_the_extension_case_insensitively() {
        let fonts = listable_fonts([face("A", 400, "/f/A.TTF"), face("B", 400, "/f/B.Otf")]);
        assert_eq!(fonts.len(), 2);
    }

    #[test]
    fn drops_italic_faces() {
        let mut italic = face("A", 400, "/f/a-italic.ttf");
        italic.italic = true;
        let fonts = listable_fonts([italic, face("A", 400, "/f/a.ttf")]);
        assert_eq!(paths(&fonts), ["/f/a.ttf"]);
    }

    #[test]
    fn sorts_by_family_then_weight_then_postscript() {
        let mut b = face("A", 400, "/f/a-alt.ttf");
        b.postscript = "A-Alt".into();
        let mut a = face("A", 400, "/f/a.ttf");
        a.postscript = "A-Regular".into();
        let fonts = listable_fonts([
            face("B", 400, "/f/b.ttf"),
            face("A", 700, "/f/a-bold.ttf"),
            a,
            b,
        ]);
        assert_eq!(
            paths(&fonts),
            ["/f/a-alt.ttf", "/f/a.ttf", "/f/a-bold.ttf", "/f/b.ttf"]
        );
    }

    #[test]
    fn serializes_camel_case_fields() {
        let json = serde_json::to_value(SystemFont {
            family: "Poppins".into(),
            postscript: "Poppins-Bold".into(),
            weight: 700,
            path: "/f/p.ttf".into(),
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({"family":"Poppins","postscript":"Poppins-Bold","weight":700,"path":"/f/p.ttf"})
        );
    }
}
