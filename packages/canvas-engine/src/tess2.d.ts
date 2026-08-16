// `tess2` (a JS port of libtess2) ships no types. Only the tesselation entry point and the two
// constants `ink-stroke-object-type.ts` passes to it are declared here — the rest of the
// library's surface is unused.
declare module "tess2" {
  interface TesselateOptions {
    contours: number[][];
    windingRule?: number;
    elementType?: number;
    polySize?: number;
    vertexSize?: number;
  }

  interface TesselateResult {
    vertices: number[];
    vertexIndices: number[];
    vertexCount: number;
    elements: number[];
    elementCount: number;
  }

  const Tess2: {
    tesselate(options: TesselateOptions): TesselateResult;
    readonly WINDING_ODD: number;
    readonly WINDING_NONZERO: number;
    readonly POLYGONS: number;
    readonly CONNECTED_POLYGONS: number;
    readonly BOUNDARY_CONTOURS: number;
  };

  export default Tess2;
}
