import { invoke } from "@tauri-apps/api/core";
import type { SearchQueryDto, SearchResultsDto } from "./types.js";

export function search(query: SearchQueryDto): Promise<SearchResultsDto> {
  return invoke("search", { query });
}
