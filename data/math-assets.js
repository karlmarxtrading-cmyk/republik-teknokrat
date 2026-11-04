// math-assets.js
// ------------------------------------------------------------
// Allowlist for IMAGE math-visual blocks. Only locally reviewed
// assets belong here; remote URLs and inline data are rejected by
// the renderer.
// ------------------------------------------------------------

export const MATH_ASSETS = Object.freeze({
  'sample-coordinate-plane': Object.freeze({
    src: './assets/math/sample-coordinate-plane.svg',
    mimeType: 'image/svg+xml',
    alt: 'A labeled Cartesian coordinate plane with horizontal x-axis and vertical y-axis.',
  }),
});

