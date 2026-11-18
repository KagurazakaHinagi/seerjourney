# Resource and license audit

Audit date: 2026-11-17. Scope: the application source, bundled non-map artwork,
browser bundles, and the exact npm dependencies in `package-lock.json`.
Externally supplied map mods and campaign content are deliberately excluded.

## Project license and artwork

The project uses [Apache-2.0](../LICENSE). [NOTICE](../NOTICE) records the project
and third-party boundaries. Preserve both files when distributing the application.
The project license does not replace any dependency's own license.

The nautical SeerJourney mark is project-specific vector artwork. Its geometry
and PNG generation are available in `tools/generate_icons.py`; the SVG and PNG
files are under `assets/icons/`. The tomb marker is separate project-specific
vector artwork in `assets/iconoir/tomb.svg`. Neither is an Iconoir library icon.
These assets were developed for this project with AI assistance; this audit
records their source provenance and does not establish independent originality
or trademark clearance.

All other interface and bookmark icons are Iconoir regular SVGs from version
7.12.2, pinned to commit `39834e3f193bc0cca2c36bebb6a650471977433d`. The originals
keep the upstream geometry, while generated symbol wrappers and UI styles adapt
their presentation. [The asset README](../assets/iconoir/README.md) describes the
mapping. The full [MIT notice](../assets/iconoir/LICENSE) credits Luca Burgio.
The upstream license is available in the [Iconoir repository](https://github.com/iconoir-icons/iconoir/blob/main/LICENSE).

The UI references fonts installed on the viewer's device (`-apple-system`,
Segoe UI, Iowan Old Style, Palatino Linotype, Georgia, and generic fallbacks).
There are no redistributed webfont files. Map labels and map-specific fonts are
part of externally supplied map content and are outside this audit.

## JavaScript dependencies

[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) lists every locked dependency,
its exact version, license, distribution role, and retained license text.
[licenses/index.json](../licenses/index.json) includes the upstream links and
SHA-256 hashes of those copies. The inventory includes development dependencies
and optional platform binaries, not only packages shipped to browsers.

The current lockfile declares MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC,
BlueOak-1.0.0, and DOMPurify's `MPL-2.0 OR Apache-2.0` choice. This distribution
elects Apache-2.0 for DOMPurify and preserves both upstream texts. No dependency
declares a mandatory copyleft license in this lockfile. These findings describe
the supplied license metadata and notices; they are not a guarantee that all
upstream code has been independently cleared.

The actual browser bundles contain:

| Bundle | Packages | License terms |
| --- | --- | --- |
| Image upload | `@vercel/blob`, `@vercel/oidc` | Apache-2.0 |
| Image upload | `is-node-process`, `is-buffer`, `jose`, `retry`, `async-retry`, `throttleit` | MIT |
| Markdown | `marked` | MIT, retaining its complete additional Markdown notice |
| Markdown | `dompurify` | Apache-2.0 choice of its dual license |

The checker derives browser usage from esbuild's output metadata rather than
assuming every installed package reaches the browser. Build output carries the
full notices and license copies alongside the minified bundles. Bundling and
minification are disclosed in `NOTICE`; upstream source files are not patched.

### Specific notice issues found

- `marked` includes a John Gruber Markdown notice in addition to its MIT text.
  The complete [upstream license](https://github.com/markedjs/marked/blob/v18.2.1/LICENSE)
  is retained, including that notice.
- `saxes@6.0.0` omits `LICENSE` from its npm archive. The full text is retained
  from [the matching upstream tag](https://github.com/lddubeau/saxes/blob/v6.0.0/LICENSE),
  including inherited sax and historical MIT notices.
- `is-node-process@1.2.0` declares MIT in its [upstream package metadata](https://github.com/mswjs/is-node-process/blob/main/package.json)
  but supplies no separate license file or copyright notice in npm or its
  repository. The inventory explicitly retains that declaration and standard
  MIT terms without inventing an owner. This is an upstream documentation gap,
  not a missing attribution silently treated as verified.
- Optional `@esbuild/*` native packages share the exact esbuild release's MIT
  license. Their entries use the license shipped in the main `esbuild` package.
- Iconoir's original license is retained. The custom tomb's project license is
  explicitly distinguished from the upstream MIT license.

## Optional Python maintenance tools

The application does not install or redistribute Python libraries. The icon,
demo map, and tile preparation scripts use [Pillow](https://pillow.readthedocs.io/en/stable/about.html#license)
(MIT-CMU/HPND notices in its distribution). Install Pillow separately and
preserve its own distribution notices if you redistribute a Python environment.
The older map-specific extraction scripts and their NumPy/SciPy requirements
were archived with the external map; they are not part of this source release.
Using an image-processing library does not, by itself, change the license of
independently authored image inputs or outputs.

## CI and referenced tools

The GitHub Actions workflow uses [actions/checkout v4.2.2](https://github.com/actions/checkout/tree/11bd71901bbe5b1630ceea73d27597364c9af683)
and [actions/setup-node v4.4.0](https://github.com/actions/setup-node/tree/49933ea5288caeca8642d1e84afbd3f7d6820020),
both under the MIT license. The workflow pins their reviewed commit IDs; it
references those actions rather than redistributing their implementations in
this application. Operators install the [Vercel CLI](https://vercel.com/docs/cli)
separately for deployment. Neither the CLI nor a GitHub runner image is bundled
in the published application. `DESIGN.md` separately credits the external
design-document format it references.

## Reproducing and maintaining the audit

```sh
npm ci
node scripts/check-licenses.cjs
```

The check needs the development dependencies to inspect the browser bundles.
It runs offline, compares installed metadata with the lockfile, rejects an
unreviewed license expression, and checks all retained texts and the generated
inventory. After intentionally updating a dependency, inspect its source and
notices, then regenerate and review:

```sh
node scripts/check-licenses.cjs --write
git diff -- THIRD_PARTY_NOTICES.md licenses/
```

Do not remove upstream notices during cleanup. Add any new fonts, icons,
illustrations, vendored code, or runtime CDN resources to the audit before
publishing them. A source-only GitHub release must exclude deployment maps,
private campaign saves, uploads, credentials, and old Git objects containing
those files; see the publishing documentation for the clean export workflow.
