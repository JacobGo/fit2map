import L from 'leaflet';
import leafletImage from 'leaflet-image';
import 'leaflet-providers';
import 'leaflet-easybutton';

import * as ui from './ui';


const INIT_COORDS = [34.0522, -118.243];

// CartoDB now requires an API key. Get a free one at https://carto.com/basemaps/apikey/
// and set it here. Without a key, CartoDB themes will not load.
const CARTO_API_KEY = 'cb1_4xcu_1_50ecfa830b6d5255b9e06767';

const DEFAULT_OPTIONS = {
    theme: 'CartoDB.DarkMatter',
    lineOptions: {
        color: '#0CB1E8',
        weight: 1,
        opacity: 0.5,
        smoothFactor: 1,
        overrideExisting: true,
        detectColors: true,
    },
    markerOptions: {
        color: '#00FF00',
        weight: 3,
        radius: 5,
        opacity: 0.5,
    },
};

const ACTIVITY_COLORS = {
    'walking':  '#ffc0cb',
    'hiking':   '#ffc0cb',
    'running':  '#ff0000',
    'cycling':  '#00ff00',
    'swimming': '#0000ff',
};


export default class GpxMap {
    constructor(options) {
        this.options = options || DEFAULT_OPTIONS;
        this.tracks = [];
        this.filters = { minDate: null, maxDate: null };
        this.imageMarkers = [];

        this.map = L.map('background-map', {
            center: INIT_COORDS,
            zoom: 10,
            preferCanvas: true,
        });

        L.easyButton({
            type: 'animate',
            states: [{
                icon: 'fa-camera fa-lg',
                stateName: 'default',
                title: 'Export as png',
                onClick: () => {
                    let modal = ui.showModal('exportImage')
                        .afterClose(() => modal.destroy());

                    document.getElementById('render-export').onclick = (e) => {
                        e.preventDefault();
                        let output = document.getElementById('export-output');
                        output.innerHTML = 'Rendering <i class="fa fa-cog fa-spin"></i>';
                        let form = document.getElementById('export-settings').elements;
                        this.screenshot(form.format.value, output);
                    };
                },
            }],
        }).addTo(this.map);

        L.easyButton({
            type: 'animate',
            states: [{
                icon: 'fa-sliders fa-lg',
                stateName: 'default',
                title: 'Open settings dialog',
                onClick: () => {
                    ui.buildSettingsModal(this.tracks, this.options, (opts) => {
                        this.updateOptions(opts);
                        this.saveOptions(opts);
                    }).show();
                },
            }],
        }).addTo(this.map);

        L.easyButton({
            type: 'animate',
            states: [{
                icon: 'fa-filter fa-lg',
                stateName: 'default',
                title: 'Filter displayed tracks',
                onClick: () => {
                    ui.buildFilterModal(this.tracks, this.filters, (f) => {
                        this.filters = f;
                        this.applyFilters();
                    }).show();
                },
            }],
        }).addTo(this.map);

        this.viewAll = L.easyButton({
            type: 'animate',
            states: [{
                icon: 'fa-map fa-lg',
                stateName: 'default',
                title: 'Zoom to all tracks',
                onClick: () => this.center(),
            }],
        }).addTo(this.map);

        this.markScrolled = () => {
            this.map.removeEventListener('movestart', this.markScrolled);
            this.scrolled = true;
        };

        this.clearScroll();
        this._initUrlState();
        this.viewAll.disable();
        this.switchTheme(this.options.theme);
        this.requestBrowserLocation();
    }

    clearScroll() {
        this.scrolled = false;
        this.map.addEventListener('movestart', this.markScrolled);
    }

    _initUrlState() {
        const hash = window.location.hash.slice(1);
        const parts = hash.split('/');
        if (parts.length === 3) {
            const zoom = parseInt(parts[0]);
            const lat  = parseFloat(parts[1]);
            const lng  = parseFloat(parts[2]);
            if (!isNaN(zoom) && !isNaN(lat) && !isNaN(lng)) {
                this.map.setView([lat, lng], zoom);
            }
        }

        this.map.on('moveend', () => {
            const c = this.map.getCenter();
            const z = this.map.getZoom();
            history.replaceState(null, '', `#${z}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}`);
        });
    }

    switchTheme(themeName) {
        if (this.mapTiles) {
            this.mapTiles.removeFrom(this.map);
        }
        if (themeName !== 'No map') {
            const opts = themeName.startsWith('CartoDB.') ? { apikey: CARTO_API_KEY } : {};
            this.mapTiles = L.tileLayer.provider(themeName, opts);
            this.mapTiles.addTo(this.map, { detectRetina: true });
        }
    }

    saveOptions(opts) {
        window.localStorage.setItem('options', JSON.stringify(opts));
    }

    restoreSavedOptions() {
        const raw = window.localStorage.getItem('options');
        if (raw === null) return;
        const opts = JSON.parse(raw);
        if (typeof opts === 'object') this.updateOptions(opts);
    }

    updateOptions(opts) {
        if (opts.theme !== this.options.theme) {
            this.switchTheme(opts.theme);
        }

        if (opts.lineOptions.overrideExisting) {
            this.tracks.forEach(track => {
                track.line.setStyle({
                    color:   opts.lineOptions.color,
                    weight:  opts.lineOptions.weight,
                    opacity: opts.lineOptions.opacity,
                });
                track._baseOpacity = opts.lineOptions.opacity;
                track.line.redraw();
            });

            const mo = opts.markerOptions;
            this.imageMarkers.forEach(marker => {
                marker.setStyle({
                    color:   mo.color,
                    weight:  mo.weight,
                    opacity: mo.opacity,
                    radius:  mo.radius,
                });
                marker.redraw();
            });
        }

        this.options = opts;
        this._applyScrub();
    }

    applyFilters() {
        const dateBounds = {
            min: new Date(this.filters.minDate || '1900/01/01'),
            max: new Date(this.filters.maxDate || '2500/01/01'),
        };

        const shouldHide = [
            (t) => t.timestamp && dateBounds.min > t.timestamp,
            (t) => t.timestamp && dateBounds.max < t.timestamp,
        ];

        for (const track of this.tracks) {
            const hide = shouldHide.some(f => f(track));
            if (hide && track.visible) {
                track.line.remove();
                track.visible = false;
            } else if (!hide && !track.visible) {
                track.line.addTo(this.map);
                track.visible = true;
            }
        }

        this._applyScrub();
    }

    requestBrowserLocation() {
        navigator.geolocation.getCurrentPosition(pos => {
            if (!this.scrolled && this.tracks.length === 0) {
                this.map.panTo([pos.coords.latitude, pos.coords.longitude], {
                    noMoveStart: true,
                    animate: false,
                });
                this.clearScroll();
            }
        });
    }

    _haversineKm(points) {
        const R = 6371;
        let dist = 0;
        for (let i = 1; i < points.length; i++) {
            const lat1 = points[i - 1].lat * Math.PI / 180;
            const lat2 = points[i].lat * Math.PI / 180;
            const dlat = lat2 - lat1;
            const dlng = (points[i].lng - points[i - 1].lng) * Math.PI / 180;
            const a = Math.sin(dlat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlng / 2) ** 2;
            dist += 2 * R * Math.asin(Math.sqrt(a));
        }
        return dist;
    }

    _showTrackPopup(track, e) {
        const km   = this._haversineKm(track.points).toFixed(1);
        const date = track.timestamp ? track.timestamp.toLocaleDateString() : 'Unknown date';
        const type = track.activityType
            ? track.activityType.charAt(0).toUpperCase() + track.activityType.slice(1)
            : (track.name || 'Activity');
        L.popup()
            .setLatLng(e.latlng)
            .setContent(`<b>${type}</b><br>${date}<br>${km} km`)
            .openOn(this.map);
    }

    addTrack(track) {
        this.viewAll.enable();
        const lineOptions = Object.assign({}, this.options.lineOptions);

        if (lineOptions.detectColors) {
            if (track.activityType) {
                const color = ACTIVITY_COLORS[track.activityType.toLowerCase()];
                if (color) lineOptions.color = color;
            }

            if (/-(Hike|Walk)\.gpx/.test(track.filename)) {
                lineOptions.color = ACTIVITY_COLORS['hiking'];
            } else if (/-Run\.gpx/.test(track.filename)) {
                lineOptions.color = ACTIVITY_COLORS['running'];
            } else if (/-Ride\.gpx/.test(track.filename)) {
                lineOptions.color = ACTIVITY_COLORS['cycling'];
            } else if (/-Swim\.gpx/.test(track.filename)) {
                lineOptions.color = ACTIVITY_COLORS['swimming'];
            }
        }

        const line = L.polyline(track.points, lineOptions)
            .on('click', e => this._showTrackPopup(track, e))
            .addTo(this.map);
        this.tracks.push(Object.assign({ line, visible: true, _baseOpacity: lineOptions.opacity }, track));
        this._updateScrubber();
    }

    _updateScrubber() {
        const timestamps = this.tracks.filter(t => t.timestamp).map(t => t.timestamp.getTime());
        if (timestamps.length === 0) return;

        const minTs = Math.min(...timestamps);
        const maxTs = Math.max(...timestamps);

        const scrubberEl = document.getElementById('scrubber');
        const rangeEl    = document.getElementById('scrubber-range');
        const dateEl     = document.getElementById('scrubber-date');
        if (!scrubberEl) return;

        rangeEl.min = minTs;
        rangeEl.max = maxTs;

        if (!this._scrubberTouched) {
            rangeEl.value = maxTs;
            dateEl.textContent = new Date(maxTs).toLocaleDateString();
        }

        scrubberEl.classList.remove('hidden');
        this._initScrubberControls();
    }

    _initScrubberControls() {
        if (this._scrubberInited) return;
        this._scrubberInited = true;

        const rangeEl = document.getElementById('scrubber-range');
        const dateEl  = document.getElementById('scrubber-date');
        const playEl  = document.getElementById('scrubber-play');

        rangeEl.addEventListener('input', () => {
            this._scrubberTouched = true;
            const ts = parseInt(rangeEl.value);
            dateEl.textContent = new Date(ts).toLocaleDateString();
            this._scrubTo(ts);
        });

        let rafId = null;

        const stopAnim = () => {
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
            playEl.innerHTML = '&#9654;';
        };

        const startAnim = () => {
            const minTs = parseInt(rangeEl.min);
            const maxTs = parseInt(rangeEl.max);
            let startTs = parseInt(rangeEl.value);

            if (startTs >= maxTs) startTs = minTs;

            const duration = 10000;
            const elapsed0 = ((startTs - minTs) / (maxTs - minTs)) * duration;
            const t0 = performance.now() - elapsed0;

            playEl.innerHTML = '&#9646;&#9646;';

            const step = (now) => {
                const progress = Math.min((now - t0) / duration, 1);
                const ts = parseInt(rangeEl.min) + (parseInt(rangeEl.max) - parseInt(rangeEl.min)) * progress;
                rangeEl.value = ts;
                this._scrubberTouched = true;
                dateEl.textContent = new Date(ts).toLocaleDateString();
                this._scrubTo(ts);
                if (progress < 1) {
                    rafId = requestAnimationFrame(step);
                } else {
                    stopAnim();
                }
            };

            rafId = requestAnimationFrame(step);
        };

        playEl.addEventListener('click', () => {
            if (rafId !== null) {
                stopAnim();
            } else {
                startAnim();
            }
        });
    }

    _scrubTo(ts) {
        const scrubDate = new Date(ts);
        for (const track of this.tracks) {
            if (!track.timestamp) continue;
            if (track.timestamp > scrubDate) {
                track.line.setStyle({ opacity: 0 });
            } else if (track.visible) {
                track.line.setStyle({ opacity: track._baseOpacity });
            }
        }
    }

    _applyScrub() {
        if (!this._scrubberInited) return;
        const rangeEl = document.getElementById('scrubber-range');
        if (rangeEl) this._scrubTo(parseInt(rangeEl.value));
    }

    async markerClick(image) {
        const latitude  = await image.latitude();
        const longitude = await image.longitude();
        const imageData = await image.getImageData();
        L.popup({ minWidth: 512 })
            .setLatLng(L.latLng(latitude, longitude))
            .setContent(`<img src="${imageData}" width="512" height="100%">`)
            .addTo(this.map);
    }

    async addImage(image) {
        const lat = await image.latitude();
        const lng = await image.longitude();
        const marker = L.circleMarker(L.latLng(lat, lng), Object.assign({}, this.options.markerOptions))
            .on('click', () => this.markerClick(image))
            .addTo(this.map);
        this.imageMarkers.push(marker);
    }

    recenter() {
        if (!this.scrolled) this.center();
    }

    center() {
        if (this.tracks.length === 0 && this.imageMarkers.length === 0) return;

        const tracksAndImages = this.tracks.map(t => t.line).concat(this.imageMarkers);
        this.map.fitBounds(L.featureGroup(tracksAndImages).getBounds(), {
            noMoveStart: true,
            animate: false,
            padding: [50, 20],
        });

        if (!this.scrolled) this.clearScroll();
    }

    screenshot(format, domNode) {
        leafletImage(this.map, (err, canvas) => {
            if (err) return window.alert(err);

            const link = document.createElement('a');

            if (format === 'png') {
                link.download = 'fit2map-export.png';
                link.innerText = 'Download as PNG';
                canvas.toBlob(blob => {
                    link.href = URL.createObjectURL(blob);
                    domNode.innerText = '';
                    domNode.appendChild(link);
                });
            } else if (format === 'svg') {
                const scale = 2;
                const bounds = this.map.getPixelBounds();
                bounds.min = bounds.min.multiplyBy(scale);
                bounds.max = bounds.max.multiplyBy(scale);
                const left   = bounds.min.x;
                const top    = bounds.min.y;
                const width  = bounds.getSize().x;
                const height = bounds.getSize().y;

                const svg  = L.SVG.create('svg');
                const root = L.SVG.create('g');
                svg.setAttribute('viewBox', `${left} ${top} ${width} ${height}`);

                this.tracks.forEach(track => {
                    const pts = track.points
                        .map(ll => this.map.project(ll).multiplyBy(scale * 10).round().divideBy(10))
                        .reduce((acc, next) => {
                            const prev = acc[acc.length - 1];
                            if (!prev || prev.x !== next.x || prev.y !== next.y) acc.push(next);
                            return acc;
                        }, []);

                    if (!pts.some(pt => bounds.contains(pt))) return;

                    const el = L.SVG.create('path');
                    el.setAttribute('d', L.SVG.pointsToPath([pts], false));
                    el.setAttribute('stroke',         track.line.options.color);
                    el.setAttribute('stroke-opacity', track.line.options.opacity);
                    el.setAttribute('stroke-width',   scale * track.line.options.weight);
                    el.setAttribute('stroke-linecap',  'round');
                    el.setAttribute('stroke-linejoin', 'round');
                    el.setAttribute('fill', 'none');
                    root.appendChild(el);
                });

                svg.appendChild(root);
                link.innerText  = 'Download as SVG';
                link.download   = 'fit2map-export.svg';
                link.href = URL.createObjectURL(
                    new Blob([(new XMLSerializer()).serializeToString(svg)], { type: 'application/octet-stream' })
                );
                domNode.innerText = '';
                domNode.appendChild(link);
            }
        });
    }
}
