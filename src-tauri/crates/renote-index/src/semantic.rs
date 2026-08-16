//! Phase 13's local semantic layer: a bundled static-embedding model (MinishLab's
//! `potion-base-2M`, MIT — see the plan's Appendix C) computes a 64-dim vector per page inside
//! the existing sync-on-write index path ([`crate::page_index::index_page`]), stored in
//! `page_vector`, searched by brute-force cosine. Token-lookup-and-mean-pool only — zero matrix
//! multiplies, no ONNX runtime, no network — which is what lets this run inline on every save
//! without anyone noticing.
//!
//! Vectors are L2-normalized by the model (`config.json`'s `normalize: true`), so cosine
//! similarity between two of them is exactly their dot product — no separate norm computation
//! anywhere in this module.

use std::sync::OnceLock;

use model2vec_rs::model::StaticModel;
use rusqlite::{params, Connection};

use crate::error::IndexError;

const TOKENIZER_BYTES: &[u8] = include_bytes!("../model/tokenizer.json");
const MODEL_BYTES: &[u8] = include_bytes!("../model/model.safetensors");
const CONFIG_BYTES: &[u8] = include_bytes!("../model/config.json");

/// Cap on how much of a page's extracted text gets embedded, bounding the worst case (a
/// pathological multi-hundred-KB page) so a save can't stall tokenizing/pooling an unbounded
/// string. Costs nothing on real notes: mean-pooling washes out topical signal well before a
/// page's text gets anywhere near this long anyway (see `page_index`'s "one vector per page"
/// doc comment on the granularity trade-off this cap shares).
const MAX_EMBED_CHARS: usize = 20_000;

/// Parsed once per process (the ~7.6MB safetensors parse is the expensive part), even though
/// every command opens a fresh `Connection` — this crate has no other long-lived process state
/// to hang it on, so a `OnceLock` is simplest.
fn model() -> &'static StaticModel {
    static MODEL: OnceLock<StaticModel> = OnceLock::new();
    MODEL.get_or_init(|| {
        StaticModel::from_bytes(TOKENIZER_BYTES, MODEL_BYTES, CONFIG_BYTES, None)
            .expect("bundled model2vec weights failed to load — see renote-index/model/")
    })
}

/// Embeds `text` into the bundled model's vector space. Empty input still returns a valid
/// (zero) vector rather than erroring — [`crate::page_index::index_page`] calls this
/// unconditionally, and an empty page is an ordinary state, not an error.
pub fn embed(text: &str) -> Vec<f32> {
    let truncated = match text.char_indices().nth(MAX_EMBED_CHARS) {
        Some((byte_index, _)) => &text[..byte_index],
        None => text,
    };
    model().encode(&[truncated.to_string()]).into_iter().next().unwrap_or_default()
}

/// Bare little-endian f32, no header — the same house format `renote-storage::blob` uses for
/// ink-stroke points.
fn encode_vec(vector: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(vector.len() * 4);
    for value in vector {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

fn decode_vec(bytes: &[u8]) -> Vec<f32> {
    bytes.chunks_exact(4).map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap())).collect()
}

/// Upserts `page_id`'s embedding vector. Called from [`crate::page_index::index_page`] right
/// after the `page_fts` delete-then-insert, reusing the same extracted body text it already
/// computed — semantic and lexical search never disagree about what a page contains.
pub fn upsert_page_vector(
    conn: &Connection,
    page_id: &str,
    vector: &[f32],
) -> Result<(), IndexError> {
    conn.execute(
        "INSERT INTO page_vector (page_id, dim, vec) VALUES (?1, ?2, ?3)
         ON CONFLICT(page_id) DO UPDATE SET dim = excluded.dim, vec = excluded.vec",
        params![page_id, vector.len() as i64, encode_vec(vector)],
    )?;
    Ok(())
}

/// Deletes `page_id`'s stored vector, if any. Called from [`crate::page_index::remove_page`].
pub fn remove_page_vector(conn: &Connection, page_id: &str) -> Result<(), IndexError> {
    conn.execute("DELETE FROM page_vector WHERE page_id = ?1", params![page_id])?;
    Ok(())
}

/// Reads back a page's own stored vector (no re-embedding) — [`nearest`]'s callers use this
/// rather than re-embedding a page's current text, since `index_page` already kept it fresh.
pub fn page_vector(conn: &Connection, page_id: &str) -> Result<Option<Vec<f32>>, IndexError> {
    let result =
        conn.query_row("SELECT vec FROM page_vector WHERE page_id = ?1", params![page_id], |row| {
            row.get::<_, Vec<u8>>(0)
        });
    match result {
        Ok(bytes) => Ok(Some(decode_vec(&bytes))),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(err) => Err(err.into()),
    }
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// One nearest-neighbour hit: a page id and its cosine similarity to the query vector.
#[derive(Debug, Clone, PartialEq)]
pub struct SemanticHit {
    pub page_id: String,
    pub score: f32,
}

/// Ranks every other page in `conn`'s index by similarity to `query_vector`, optionally
/// excluding `exclude_page_id` (a page is never its own "related" result — `Some` when
/// `query_vector` came from an existing page's own stored vector, `None` when it came from an
/// ad-hoc search-query embedding with no page to exclude), highest similarity first, capped at
/// `limit`. Rows whose stored `dim` doesn't match `query_vector.len()` are skipped rather than
/// mis-read (see `page_vector`'s table doc comment) — in practice this only happens if the
/// bundled model is ever swapped without the schema-version bump that's meant to force a full
/// rebuild alongside it.
///
/// One `SELECT` plus an in-process sort, no SQLite extension, no ANN index — see the plan's
/// Appendix C for the measured cost at 1k/10k/50k pages this brute-force approach is budgeted
/// against.
pub fn nearest(
    conn: &Connection,
    query_vector: &[f32],
    exclude_page_id: Option<&str>,
    limit: usize,
) -> Result<Vec<SemanticHit>, IndexError> {
    let mut stmt = conn.prepare("SELECT page_id, dim, vec FROM page_vector WHERE page_id != ?1")?;
    let dim = query_vector.len();
    let rows = stmt.query_map(params![exclude_page_id.unwrap_or("")], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, Vec<u8>>(2)?))
    })?;

    let mut hits: Vec<SemanticHit> = Vec::new();
    for row in rows {
        let (page_id, row_dim, vec_bytes) = row?;
        if row_dim as usize != dim {
            continue;
        }
        hits.push(SemanticHit { page_id, score: dot(query_vector, &decode_vec(&vec_bytes)) });
    }
    hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    hits.truncate(limit);
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The one runnable check the plan asks for: index three pages (two on the same topic, one
    /// unrelated) and assert the topical sibling outranks the unrelated page. Fails if the
    /// model, blob layout, normalization, or dot product breaks.
    #[test]
    fn a_topically_similar_page_outranks_an_unrelated_one() {
        let rocket_a = embed("Falcon 9 rocket engines burn kerosene and liquid oxygen for thrust");
        let rocket_b = embed("SpaceX rockets use kerolox propellant in their Merlin engines");
        let grocery = embed("Buy milk, eggs, and bread from the grocery store this weekend");

        assert_eq!(rocket_a.len(), 64);

        let conn = Connection::open_in_memory().expect("open in-memory db");
        crate::schema::ensure_schema(&conn).expect("ensure_schema");
        upsert_page_vector(&conn, "rocket-a", &rocket_a).expect("upsert rocket-a");
        upsert_page_vector(&conn, "rocket-b", &rocket_b).expect("upsert rocket-b");
        upsert_page_vector(&conn, "grocery", &grocery).expect("upsert grocery");

        let hits = nearest(&conn, &rocket_a, Some("rocket-a"), 10).expect("nearest");
        let rocket_b_score =
            hits.iter().find(|h| h.page_id == "rocket-b").expect("rocket-b present").score;
        let grocery_score =
            hits.iter().find(|h| h.page_id == "grocery").expect("grocery present").score;
        assert!(
            rocket_b_score > grocery_score,
            "topical sibling ({rocket_b_score}) should outrank the unrelated page ({grocery_score})"
        );
    }

    /// The plan's Appendix C budget: "`embed()` on a 5KB page < 5ms on target hardware (CI
    /// assert < 25ms)". Warms the model first (its one-time ~7.6MB safetensors parse is not part
    /// of the per-call budget being measured — see `model()`'s doc comment on `OnceLock`) so the
    /// timed call only measures tokenize-gather-mean, not model load.
    #[test]
    fn embedding_a_5kb_page_stays_within_the_ci_budget() {
        let text = "the quick brown fox jumps over the lazy dog ".repeat(100); // ~4.5KB
        embed("warm up the model2vec OnceLock before timing");

        let started_at = std::time::Instant::now();
        let vector = embed(&text);
        let elapsed = started_at.elapsed();

        assert_eq!(vector.len(), 64);
        assert!(elapsed.as_millis() < 25, "embed() took {elapsed:?}, CI budget is 25ms");
    }

    #[test]
    fn round_trips_a_vector_through_the_blob_encoding() {
        let vector = vec![0.5_f32, -0.25, 1.0, -1.0];
        assert_eq!(decode_vec(&encode_vec(&vector)), vector);
    }

    #[test]
    fn nearest_excludes_the_query_page_and_respects_the_limit() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        crate::schema::ensure_schema(&conn).expect("ensure_schema");
        for id in ["a", "b", "c"] {
            upsert_page_vector(&conn, id, &embed(id)).expect("upsert");
        }
        let hits = nearest(&conn, &embed("a"), Some("a"), 1).expect("nearest");
        assert_eq!(hits.len(), 1);
        assert_ne!(hits[0].page_id, "a");
    }
}
