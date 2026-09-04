/// <reference types="vite/client" />

// leaflet.heat has no @types package — declare it as a side-effect module
// that patches L.heatLayer onto the Leaflet namespace.
declare module 'leaflet.heat' {
  // The import is used purely for its side-effect of patching leaflet.
}
