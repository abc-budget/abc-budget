/**
 * Data Access Object interfaces for the import statement pipeline.
 * @module internal/importStatement/dao
 * @internal
 *
 * PORT of `webapp/libs/engine/src/importStatement/dao.ts` — interfaces only.
 *
 * Adaptations (diff-audit):
 *   1. **IoC removal**: `IDBFileFormatDAO` and `IDBFileSourceDAO` implementations
 *      depended on the prior-art `Container` superclass pattern.  Those concrete
 *      classes are NOT ported here; the DAO interfaces are all service.ts needs.
 *      Concrete implementations will be added when the persistence layer is wired
 *      end-to-end (Task 5+).
 *   2. **Import paths** adjusted for internal layout.
 *   3. **verbatimModuleSyntax** — `import type` for type-only imports.
 *
 * Store constants (FILE_FORMATS_STORE, FILE_SOURCES_STORE) and store configs are
 * included verbatim — they are referenced in migration steps.
 */

import type { Dao } from '../store/dao';
import type { FileFormat, FileSource } from './types';

// ---------------------------------------------------------------------------
// Store names and configs (verbatim from prior art)
// ---------------------------------------------------------------------------

/** Name of the file formats store in IndexedDB */
export const FILE_FORMATS_STORE = 'fileFormats';

/** Name of the file sources store in IndexedDB */
export const FILE_SOURCES_STORE = 'fileSources';

// ---------------------------------------------------------------------------
// DAO interfaces (verbatim from prior art — IoC-independent)
// ---------------------------------------------------------------------------

/**
 * Data Access Object interface for FileFormat.
 * Provides CRUD operations on file formats.
 */
export type FileFormatDAO = Dao<number, FileFormat>;

/**
 * Data Access Object interface for FileSource.
 * Provides CRUD operations on file sources.
 */
export interface FileSourceDAO extends Dao<number, FileSource> {
  /**
   * Gets a file source by its name.
   * @param name - The name of the file source to get
   * @returns Promise resolving to the file source or null if not found
   */
  getByName(name: string): Promise<FileSource | null>;

  /**
   * Gets all file sources associated with a specific file format.
   * @param fileFormatId - The ID of the file format
   * @returns Promise resolving to an array of file sources
   */
  getByFormatId(fileFormatId: number): Promise<FileSource[]>;
}
