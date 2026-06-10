# Currency Data Provenance

## Package

`@abc-budget/currencies@1.0.50`

## Source

Local Gradle project: `D:\abc-budget\currency-data`  
Output directory: `D:\abc-budget\currency-data\dist\`  
Files vendored: `currencies.json`, `locale2currency.json`

## Vendoring decision (2026-06-10)

`@abc-budget/currencies` is published to GitHub Packages, which requires authentication tokens
even for public installs — an OSS friction barrier that complicates CI and contributor onboarding.
Files are vendored verbatim to avoid the token requirement.

Switch to a direct `npm`/`pnpm` dependency if the package is ever published tokenless to the
public npm registry.

## Re-vendor procedure

1. Rebuild the dataset: run the Gradle build in `D:\abc-budget\currency-data` (produces `dist/`).
2. Re-copy the two JSON files verbatim:
   ```
   cp D:\abc-budget\currency-data\dist\currencies.json    packages/engine/src/internal/currency/data/
   cp D:\abc-budget\currency-data\dist\locale2currency.json packages/engine/src/internal/currency/data/
   ```
3. Diff-review the changes (`git diff -- '*.json'`) before committing.
4. Update the version string in this file.
