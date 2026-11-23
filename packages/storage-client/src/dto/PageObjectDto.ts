import type { BoundsDto } from "./BoundsDto";
import type { Transform2DDto } from "./Transform2DDto";

/**
 * Mirrors `renote_storage::PageObjectEnvelope` / `packages/core/src/page-object/envelope.ts`'s
 * `PageObject`. `data` stays an opaque JSON value on the Rust side (see
 * `renote_storage::model` doc comment for why); it's exported to
 * TypeScript as `unknown` (via `#[ts(type = "unknown")]`, overriding
 * ts-rs's default `serde_json::Value` mapping, which would otherwise
 * export its own standalone `JsonValue` type into a stray `bindings/`
 * folder under this crate rather than into `generated/` alongside
 * everything else) — callers narrow it per `type` the same way the
 * not-yet-built canvas-engine object-type registry will.
 */
export type PageObjectDto = {
  id: string;
  type: string;
  transform: Transform2DDto;
  bounds: BoundsDto;
  data: unknown;
};
