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
        this.viewAll.disable();
        this.switchTheme(this.options.theme);
        this.requestBrowserLocation();
    }

    clearScroll() {
        this.scrolled = false;
        this.map.addEventListener('movestart', this.markScrolled);
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
            this.tracks.forEach(({ line }) => {
                line.setStyle({
                    color:   opts.lineOptions.color,
                    weight:  opts.lineOptions.weight,
                    opacity: opts.lineOptions.opacity,
                });
                line.redraw();
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

        const line = L.polyline(track.points, lineOptions).addTo(this.map);
        this.tracks.push(Object.assign({ line, visible: true }, track));
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
