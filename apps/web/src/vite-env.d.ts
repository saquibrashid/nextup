/**
 * Vite's ambient module declarations.
 *
 * ⚠ WITHOUT THIS THE CSS IMPORT IN `main.tsx` DOES NOT COMPILE — TypeScript
 * rejects a side-effect import of a file it has no declaration for (TS2882),
 * and the tempting fix is to delete the import. That would leave a stylesheet
 * that exists and is never loaded, which is indistinguishable from having no
 * stylesheet at all and is exactly the state `T-CSS-002` exists to prevent.
 */
/// <reference types="vite/client" />
