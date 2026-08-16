//! Full-text search over the FTS5 `page_fts` table. Returns hits shaped
//! roughly like `packages/core/src/search/query.ts`'s `SearchHit` (id,
//! title, snippet, score) — field names are adapted to Rust/DB convention
//! here; the `renote-commands` layer maps these onto the exact TS-facing
//! DTO shape, since a single index database only ever covers one notebook
//! and the command layer is what fans a query out across several.

use rusqlite::{params_from_iter, types::Value as SqlValue, Connection};

use crate::error::IndexError;

/// One ranked search result.
#[derive(Debug, Clone, PartialEq)]
pub struct SearchHit {
    pub page_id: String,
    pub notebook_id: String,
    pub section_id: String,
    pub title: String,
    /// Highlighted plain-text snippet around the match, via FTS5's `snippet()`.
    pub snippet: String,
    /// Higher is more relevant (the negation of SQLite FTS5's `bm25()`,
    /// which itself is "lower/more negative is better").
    pub score: f64,
}

/// Optional filters narrowing a search beyond the free-text query.
#[derive(Debug, Clone, Copy, Default)]
pub struct SearchFilter<'a> {
    pub section_ids: Option<&'a [String]>,
    /// Restricts results to pages carrying at least one paragraph tagged
    /// with one of these tag ids (via the `paragraph_tag` table). `Some(&[])`
    /// (explicit but empty) can never match anything, same as `section_ids`.
    pub tag_ids: Option<&'a [String]>,
    /// Inclusive ISO 8601 lower bound on `page.modified_at`. Plain string
    /// comparison is sufficient since `renote-storage` always writes
    /// RFC 3339 UTC timestamps, which sort lexicographically in
    /// chronological order.
    pub modified_after: Option<&'a str>,
    /// Inclusive ISO 8601 upper bound on `page.modified_at`.
    pub modified_before: Option<&'a str>,
    /// Maximum number of hits to return. `0` is treated as "no limit".
    pub limit: usize,
}

/// Runs a full-text query against `conn`'s `page_fts`/`page` tables.
///
/// `query_text` is tokenized on whitespace and each token is treated as a
/// quoted FTS5 phrase, joined with FTS5's implicit `AND` — this both avoids
/// passing user input straight into FTS5's query-syntax parser (which
/// would error out on stray `"`/`*`/`:` etc.) and gives simple
/// all-terms-must-match behavior.
///
/// An empty/whitespace-only query normally returns no hits rather than
/// matching everything — *except* when `filter.tag_ids` is a non-empty
/// filter: "browse every page carrying this tag" (e.g. clicking a tag in
/// `TagSummaryPanel`) is a legitimate zero-free-text search, so that case
/// queries `page` directly instead of `page_fts` (no FTS5 `MATCH`/
/// `snippet()`/`bm25()` to run against empty input), with a neutral score
/// and the page title standing in for a highlighted snippet.
pub fn search(
    conn: &Connection,
    query_text: &str,
    filter: &SearchFilter<'_>,
) -> Result<Vec<SearchHit>, IndexError> {
    let match_expr = build_match_expression(query_text);
    let has_tag_filter = matches!(filter.tag_ids, Some(ids) if !ids.is_empty());

    if match_expr.is_none() && !has_tag_filter {
        return Ok(Vec::new());
    }

    let mut bound_params: Vec<SqlValue> = Vec::new();
    let mut sql = if let Some(match_expr) = match_expr {
        bound_params.push(SqlValue::Text(match_expr));
        String::from(
            "SELECT p.notebook_id, p.id, p.section_id, p.title, \
                    snippet(page_fts, 2, '', '', '…', 12) AS snippet, \
                    -bm25(page_fts) AS score \
             FROM page_fts \
             JOIN page p ON p.id = page_fts.page_id \
             WHERE page_fts MATCH ?",
        )
    } else {
        String::from(
            "SELECT p.notebook_id, p.id, p.section_id, p.title, \
                    p.title AS snippet, \
                    0.0 AS score \
             FROM page p \
             WHERE 1 = 1",
        )
    };

    if let Some(section_ids) = filter.section_ids {
        if section_ids.is_empty() {
            // An explicit-but-empty filter can never match anything.
            return Ok(Vec::new());
        }
        let placeholders = section_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        sql.push_str(&format!(" AND p.section_id IN ({placeholders})"));
        bound_params.extend(section_ids.iter().cloned().map(SqlValue::Text));
    }
    if let Some(tag_ids) = filter.tag_ids {
        if tag_ids.is_empty() {
            // An explicit-but-empty filter can never match anything.
            return Ok(Vec::new());
        }
        // A subquery (rather than a JOIN) avoids multiplying result rows when a page has
        // several paragraphs/tags matching — a page should appear at most once per hit
        // regardless of how many of its paragraphs carry a matching tag.
        let placeholders = tag_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        sql.push_str(&format!(
            " AND p.id IN (SELECT DISTINCT page_id FROM paragraph_tag WHERE tag_id IN ({placeholders}))"
        ));
        bound_params.extend(tag_ids.iter().cloned().map(SqlValue::Text));
    }
    if let Some(after) = filter.modified_after {
        sql.push_str(" AND p.modified_at >= ?");
        bound_params.push(SqlValue::Text(after.to_string()));
    }
    if let Some(before) = filter.modified_before {
        sql.push_str(" AND p.modified_at <= ?");
        bound_params.push(SqlValue::Text(before.to_string()));
    }

    sql.push_str(" ORDER BY score DESC");
    if filter.limit > 0 {
        sql.push_str(&format!(" LIMIT {}", filter.limit));
    }

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(bound_params), |row| {
        Ok(SearchHit {
            notebook_id: row.get(0)?,
            page_id: row.get(1)?,
            section_id: row.get(2)?,
            title: row.get(3)?,
            snippet: row.get(4)?,
            score: row.get(5)?,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(IndexError::from)
}

/// Builds an FTS5 `MATCH` expression that treats `query_text` as a set of
/// literal phrases ANDed together, or `None` if there's nothing to search
/// for.
fn build_match_expression(query_text: &str) -> Option<String> {
    let tokens: Vec<String> = query_text
        .split_whitespace()
        .map(|token| format!("\"{}\"", token.replace('"', "\"\"")))
        .collect();

    if tokens.is_empty() {
        None
    } else {
        Some(tokens.join(" "))
    }
}
