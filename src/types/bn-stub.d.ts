// Typecheck-only stub for "bn.js": the package ships no "types"/"typings"
// field and there is no @types/bn.js installed, so without this tsc falls
// back to type-checking the untyped CommonJS source in
// node_modules/bn.js/lib/bn.js directly — which fails under strict-ish
// checkJs (redeclared exports, Mont subclass shape, `this` covariance).
// This ambient declaration is mapped in jsconfig.json's `paths` so `import
// BN from "bn.js"` resolves here for type-checking only; the real runtime
// import still comes from node_modules via bundler resolution.
declare module "bn.js" {
  class BN {
    constructor(number?: number | string | number[] | Uint8Array | Buffer | BN, base?: number | "hex", endian?: "le" | "be");
    toNumber(): number;
    toString(base?: number | "hex", length?: number): string;
    toBuffer(endian?: "le" | "be", length?: number): Buffer;
    toBytes(endian?: "le" | "be", length?: number): number[];
    toArrayLike(type: any, endian?: "le" | "be", length?: number): any;
    toJSON(): string;
    add(b: BN): BN;
    sub(b: BN): BN;
    mul(b: BN): BN;
    div(b: BN): BN;
    mod(b: BN): BN;
    abs(): BN;
    neg(): BN;
    cmp(b: BN): number;
    eq(b: BN): boolean;
    equals(b: BN): boolean;
    gt(b: BN): boolean;
    gte(b: BN): boolean;
    lt(b: BN): boolean;
    lte(b: BN): boolean;
    isZero(): boolean;
    [key: string]: any;
  }
  export = BN;
}
