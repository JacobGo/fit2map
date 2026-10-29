import L from 'leaflet';

/**
 * TrackLayer: renders all GPS tracks on a single canvas element.
 *
 * The canvas is attached directly to the map container (not to any Leaflet
 * pane) so it is never moved by Leaflet's pan/zoom CSS animations.  Coordinates
 * are computed as:
 *
 *   containerX = worldPixelAtCacheZoom * scale - pixelOrigin.x
 *
 * where scale = 2^(currentZoom - cacheZoom) and pixelOrigin is Leaflet's
 * top-left world-pixel for the current viewport.  The canvas is redrawn on
 * every `move` event so panning stays in sync.
 */
export default class TrackLayer extends L.Layer {
    constructor() {
        super();
        this._tracks = [];
        this._canvas = null;
        this._cacheZoom = null;
    }

    onAdd(map) {
        this._map = map;
        this._cacheZoom = Math.round(map.getZoom());

        const canvas = this._canvas = document.createElement('canvas');
        canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:400';
        map.getContainer().appendChild(canvas);

        map.on('move zoom', this._redraw, this);
        map.on('zoomend resize', this._onViewReset, this);

        this._onViewReset();
        return this;
    }

    onRemove(map) {
        this._canvas.remove();
        map.off('move zoom', this._redraw, this);
        map.off('zoomend resize', this._onViewReset, this);
        this._canvas = null;
    }

    // ── Public API ──────────────────────────────────────────────────────────

    addTrack(points, options = {}) {
        const handle = {
            points,
            projected: null,    // Float32Array [x0,y0,...] at _cacheZoom
            pxBounds: null,     // bbox in _cacheZoom pixel space for culling
            color:   options.color   || '#00ffff',
            opacity: parseFloat(options.opacity) || 0.1,
            weight:  parseFloat(options.weight)  || 2,
            visible: true,
        };
        if (this._map) this._projectTrack(handle);
        this._tracks.push(handle);
        if (this._map) this._redraw();
        return handle;
    }

    updateTrack(handle, options) {
        Object.assign(handle, options);
        if (this._map) this._redraw();
    }

    setTrackVisible(handle, visible) {
        handle.visible = visible;
        if (this._map) this._redraw();
    }

    removeTrack(handle) {
        const idx = this._tracks.indexOf(handle);
        if (idx !== -1) {
            this._tracks.splice(idx, 1);
            if (this._map) this._redraw();
        }
    }

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
        for (const { points } of this._tracks) {
            for (const { lat, lng } of points) {
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
                if (lng < minLng) minLng = lng;
                if (lng > maxLng) maxLng = lng;
            }
        }
        return L.latLngBounds([minLat, minLng], [maxLat, maxLng]);
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    /** Called on zoomend and resize: resize canvas, re-project if zoom changed. */
    _onViewReset() {
        const map = this._map;
        const size = map.getSize();
        this._canvas.width  = size.x;
        this._canvas.height = size.y;

        const zoom = Math.round(map.getZoom());
        if (zoom !== this._cacheZoom) {
            this._cacheZoom = zoom;
            for (const t of this._tracks) this._projectTrack(t);
        }

        this._redraw();
    }

    _projectTrack(handle) {
        const map  = this._map;
        const zoom = this._cacheZoom;
        const pts  = handle.points;
        const n    = pts.length;

        const proj = handle.projected = new Float32Array(n * 2);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        for (let i = 0; i < n; i++) {
            const p = map.project(pts[i], zoom);
            proj[i * 2]     = p.x;
            proj[i * 2 + 1] = p.y;
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }

        handle.pxBounds = { minX, minY, maxX, maxY };
    }

    _redraw() {
        const map    = this._map;
        const canvas = this._canvas;
        const ctx    = canvas.getContext('2d');
        const w      = canvas.width;
        const h      = canvas.height;

        ctx.clearRect(0, 0, w, h);
        if (this._tracks.length === 0) return;

        // scale: cached coords are at _cacheZoom; current view may differ
        // (fractional during pinch-zoom).  containerX = worldAtCache * scale - ox
        const scale = map.getZoomScale(map.getZoom(), this._cacheZoom);
        const origin = map.getPixelOrigin();
        const ox = origin.x;
        const oy = origin.y;

        // Viewport bounds expressed in _cacheZoom pixel space for bbox culling
        const invScale = 1 / scale;
        const vpMinX = ox * invScale;
        const vpMinY = oy * invScale;
        const vpMaxX = (ox + w) * invScale;
        const vpMaxY = (oy + h) * invScale;

        // Batch tracks by style to minimise canvas state changes
        const groups = new Map();
        for (const t of this._tracks) {
            if (!t.visible || !t.projected || t.points.length < 2) continue;
            const b = t.pxBounds;
            if (b.maxX < vpMinX || b.minX > vpMaxX ||
                b.maxY < vpMinY || b.minY > vpMaxY) continue;
            const key = `${t.color}|${t.opacity}|${t.weight}`;
            if (!groups.has(key)) {
                groups.set(key, { color: t.color, opacity: t.opacity, weight: t.weight, tracks: [] });
            }
            groups.get(key).tracks.push(t);
        }

        for (const { color, opacity, weight, tracks } of groups.values()) {
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.globalAlpha = opacity;
            ctx.lineWidth   = weight;
            ctx.lineCap     = 'round';
            ctx.lineJoin    = 'round';

            for (const t of tracks) {
                const proj = t.projected;
                const n    = proj.length;
                ctx.moveTo(proj[0] * scale - ox, proj[1] * scale - oy);
                for (let i = 2; i < n; i += 2) {
                    ctx.lineTo(proj[i] * scale - ox, proj[i + 1] * scale - oy);
                }
            }

            ctx.stroke();
        }
    }
}
