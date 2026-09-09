/**
 * `qz-tray` ships as plain JS with no type declarations (and no
 * `@types/qz-tray` package exists). Left as `any` deliberately rather than
 * hand-typing QZ's full API surface: this app only ever touches it through
 * `src/api/qzPrint.ts`, which is the one place responsible for using it
 * correctly — see that file for the actual (narrow) usage.
 */
declare module "qz-tray";
