# Map rendering performance

Large maps can use a pre-generated background/fog JPEG tile pyramid. Logical grid coordinates remain independent of raster resolution. See [map deployment](map-deployment.md) for generation commands.

The renderer keeps a complete low-resolution background/fog overview and loads detailed pairs near the viewport. Each tile includes a one-pixel right/bottom overlap to prevent seams during fractional scaling. Detailed pairs appear together so a late fog image cannot expose hidden terrain. Each renderer limits concurrent requests and cancels obsolete work as the viewport moves.

Viewport coverage includes a one-tile margin; device pixel ratio is capped at two. Versioned tiles can use the service-worker cache. The API bypasses that cache. Log snapshots reuse the same renderer and dispose pending requests when replaced or closed.

The app retains unchanged fog polygons rather than rebuilding them on every status poll. Translation-only gestures skip marker scaling, route-pin scaling, and scale readout writes. Floating controls suspend expensive backdrop blur during active touch gestures and restore it afterward.

Small maps without a pyramid use their full-size raster layers. Pixel memory is roughly width × height × four bytes for each decoded RGBA image, before additional browser caches/surfaces. Avoid very large untiled backgrounds on mobile devices. Tests cover viewport bounds, request cancellation, fog-safe pairing, snapshots, cache reuse, and avoiding redundant transform work; they are not physical-device frame-rate or memory measurements.

Rendering references: [web.dev animation performance](https://web.dev/articles/animations-guide), [Safari Web Inspector](https://developer.apple.com/safari/tools/).
