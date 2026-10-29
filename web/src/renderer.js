import L from 'leaflet';

/**
 * TrackLayer: renders all GPS tracks on a single canvas element.
 *
 * Dramatically faster than individual L.Polyline objects for large track
 * collections because:
 *  - No per-track Leaflet object allocation
 *  - All tracks of the same style are drawn in one batched path call
 *  - Points are pre-projected to pixel space at the current zoom and cached
 *    in typed arrays; panning only requires a coordinate offset (no
 *    re-projection), and zoom triggers a single re-projection pass
 *  - Simple bbox culling skips invisible tracks entirely
 */
export default class TrackLayer extends L.Layer {
    constructor() {
        super();
        this._tracks = [];      // array of track handles
        this._canvas = null;
        this._origin = null;    // L.Point: pixel origin used for cached projections
        this._cacheZoom = null;
    }

    onAdd(map) {
        this._map = map;

        const canvas = this._canvas = L.DomUtil.create('canvas', 'fit2map-track-layer');
        canvas.style.position = 'absolute';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.pointerEvents = 'none';

        // overlayPane is above tile layers and below popup panes
        map.getPanes().overlayPane.appendChild(canvas);

        map.on('moveend zoomend resize', this._reset, this);
        map.on('move', this._pan, this);
        map.on('zoomanim', this._onZoomAnim, this);

        this._reset();
        return this;
    }

    onRemove(map) {
        L.DomUtil.remove(this._canvas);
        map.off('moveend zoomend resize', this._reset, this);
        map.off('move', this._pan, this);
        map.off('zoomanim', this._onZoomAnim, this);
        this._canvas = null;
    }

    // ── Public API ──────────────────────────────────────────────────────────

    /**
     * Add a track and return a handle for later updates/removal.
     * @param {Array<{lat: number, lng: number}>} points
     * @param {{ color, opacity, weight }} options
     * @returns {object} handle
     */
    addTrack(points, options = {}) {
        const handle = {
            points,
            projected: null,    // Float32Array [x0,y0, x1,y1, ...] at _cacheZoom
            pxBounds: null,     // {minX, minY, maxX, maxY} for culling
            color: options.color || '#00ffff',
            opacity: parseFloat(options.opacity) || 0.1,
            weight: parseFloat(options.weight) || 2,
            visible: true,
        };

        if (this._map) {
            this._projectTrack(handle);
        }

        this._tracks.push(handle);

        if (this._map) {
            this._redraw();
        }

        return handle;
    }

    /** Update style properties on a handle and redraw. */
    updateTrack(handle, options) {
        Object.assign(handle, options);
        if (this._map) this._redraw();
    }

    /** Toggle visibility on a handle and redraw. */
    setTrackVisible(handle, visible) {
        handle.visible = visible;
        if (this._map) this._redraw();
    }

    /** Remove a specific track. */
    removeTrack(handle) {
        const idx = this._tracks.indexOf(handle);
        if (idx !== -1) {
            this._tracks.splice(idx, 1);
            if (this._map) this._redraw();
        }
    }

    /** Re-apply style options to all tracks (for global style changes). */
    updateAllTracks(options) {
        for (const t of this._tracks) Object.assign(t, options);
        if (this._map) this._redraw();
    }

    clear() {
        this._tracks = [];
        if (this._canvas) {
            const ctx = this._canvas.getContext('2d');
            ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
        }
    }

    getBounds() {
        if (this._tracks.length === 0) return null;
        let minLat = Infinity, maxLat = -Infinity;
        let minLng = Infinity, maxLng = -Infinity;
        for (const t of this._tracks) {
            for (const { lat, lng } of t.points) {
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
                if (lng < minLng) minLng = lng;
                if (lng > maxLng) maxLng = lng;
            }
        }
        return L.latLngBounds([minLat, minLng], [maxLat, maxLng]);
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    _reset() {
        const map = this._map;
        const size = map.getSize();
        const canvas = this._canvas;

        // Align canvas to layer pane origin
        const topLeft = map.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(canvas, topLeft);

        canvas.width = size.x;
        canvas.height = size.y;

        // Re-project all tracks if zoom changed
        const zoom = map.getZoom();
        if (zoom !== this._cacheZoom) {
            this._cacheZoom = zoom;
            this._origin = map.getPixelOrigin();
            for (const t of this._tracks) this._projectTrack(t);
        } else {
            // Same zoom: update origin for pan offset calculation
            this._origin = map.getPixelOrigin();
        }

        this._redraw();
    }

    /** During smooth panning, just reposition the canvas — no redraw. */
    _pan() {
        const topLeft = this._map.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(this._canvas, topLeft);
    }

    /** Smooth zoom animation: scale the canvas with CSS transform. */
    _onZoomAnim(e) {
        const scale = this._map.getZoomScale(e.zoom);
        const offset = this._map._latLngBoundsToNewLayerBounds(
            this._map.getBounds(), e.zoom, e.center
        ).min;
        L.DomUtil.setTransform(this._canvas, offset, scale);
    }

    /** Pre-project a track's lat/lng points into pixel space at _cacheZoom. */
    _projectTrack(handle) {
        const map = this._map;
        const zoom = this._cacheZoom;
        const pts = handle.points;
        const n = pts.length;

        const proj = handle.projected = new Float32Array(n * 2);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        for (let i = 0; i < n; i++) {
            const p = map.project(pts[i], zoom);
            const x = p.x;
            const y = p.y;
            proj[i * 2]     = x;
            proj[i * 2 + 1] = y;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }

        handle.pxBounds = { minX, minY, maxX, maxY };
    }

    _redraw() {
        const map = this._map;
        const canvas = this._canvas;
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;

        ctx.clearRect(0, 0, w, h);

        if (this._tracks.length === 0) return;

        // Pixel origin: subtract from projected world coords to get canvas coords
        const origin = map.getPixelOrigin();
        const ox = origin.x;
        const oy = origin.y;

        // Viewport bounds in world pixel space for culling
        const vpMin = map.project(map.containerPointToLatLng([0, 0]), this._cacheZoom);
        const vpMax = map.project(map.containerPointToLatLng([w, h]), this._cacheZoom);
        const vpMinX = Math.min(vpMin.x, vpMax.x);
        const vpMinY = Math.min(vpMin.y, vpMax.y);
        const vpMaxX = Math.max(vpMin.x, vpMax.x);
        const vpMaxY = Math.max(vpMin.y, vpMax.y);

        // Group tracks by style key to minimise canvas state changes
        // Key: color|opacity|weight
        const groups = new Map();
        for (const t of this._tracks) {
            if (!t.visible || !t.projected || t.points.length < 2) continue;

            // Bounding-box cull
            const b = t.pxBounds;
            if (b.maxX < vpMinX || b.minX > vpMaxX ||
                b.maxY < vpMinY || b.minY > vpMaxY) continue;

            const key = `${t.color}|${t.opacity}|${t.weight}`;
            if (!groups.has(key)) {
                groups.set(key, { color: t.color, opacity: t.opacity, weight: t.weight, tracks: [] });
            }
            groups.get(key).tracks.push(t);
        }

        // Draw each style group in a single path
        for (const { color, opacity, weight, tracks } of groups.values()) {
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.globalAlpha = opacity;
            ctx.lineWidth = weight;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            for (const t of tracks) {
                const proj = t.projected;
                const n = proj.length;

                ctx.moveTo(proj[0] - ox, proj[1] - oy);
                for (let i = 2; i < n; i += 2) {
                    ctx.lineTo(proj[i] - ox, proj[i + 1] - oy);
                }
            }

            ctx.stroke();
        }
    }
}
