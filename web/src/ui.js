import picoModal from 'picomodal';
import extractTracks from './track';
import Image from './image';

const AVAILABLE_THEMES = [
    'CartoDB.DarkMatter',
    'CartoDB.DarkMatterNoLabels',
    'CartoDB.Positron',
    'CartoDB.PositronNoLabels',
    'CartoDB.Voyager',
    'Esri.WorldImagery',
    'OpenStreetMap.Mapnik',
    'OpenTopoMap',
    'Stadia.StamenTerrain',
    'Stadia.StamenTerrainBackground',
    'Stadia.StamenToner',
    'Stadia.StamenTonerLite',
    'Stadia.StamenTonerBackground',
    'Stadia.StamenWatercolor',
    'Stadia.AlidadeSmoothDark',
    'CyclOSM',
    'No map',
];

const MODAL_CONTENT = {
    help: `
<h1>fit2map</h1>
<h4>Drag and drop your Garmin <code>.fit</code> files here to visualize them on the map.</h4>

<p>Supported formats: <strong>FIT</strong>, GPX, TCX, IGC, SKIZ, DERIVE, and geotagged JPEG images.</p>

<h4>Getting your Garmin files</h4>
<p>Connect your Garmin device via USB and copy <code>.fit</code> files from
<code>GARMIN/Activities/</code> on the device, or export activities from
<a href="https://connect.garmin.com">Garmin Connect</a>.</p>

<h4>Strava users</h4>
<p>Go to your
<a href="https://www.strava.com/athlete/delete_your_account">account download page</a>
and click "Request your archive". You'll receive a ZIP file containing all your
GPS tracks (this can take several hours).</p>

<p>All processing happens in your browser &mdash; your files are never uploaded or stored anywhere.</p>

<p>Source code is available <a href="https://github.com/erik/derive">on GitHub</a> (based on the dérive project).</p>
`,

    exportImage: `
<h3>Export Image</h3>

<form id="export-settings">
    <div class="form-row">
        <label>Format:</label>
        <select name="format">
            <option selected value="png">PNG</option>
            <option value="svg">SVG (no background map)</option>
        </select>
    </div>

    <div class="form-row">
        <label></label>
        <input id="render-export" type="button" value="Render">
    </div>
</form>

<p id="export-output"></p>
`
};

function handleFileSelect(map, evt) {
    evt.stopPropagation();
    evt.preventDefault();

    let tracks = [];
    let files = Array.from(evt.dataTransfer.files);
    let modal = buildUploadModal(files.length);

    modal.show();

    const handleImage = async file => {
        const image = new Image(file);
        const hasGeolocationData = await image.hasGeolocationData();
        if (!hasGeolocationData) { throw 'No geolocation data'; }
        await map.addImage(image);
        modal.addSuccess();
    };

    const handleTrackFile = async (file) => {
        modal.setStatus(`Parsing ${file.name}\u2026`);
        modal.setProgress(0, 1);
        const extracted = await extractTracks(file, (done, total) => {
            modal.setStatus(`Parsing ${file.name}\u2026 ${done} / ${total}`);
            modal.setProgress(done, total);
        });
        const total = extracted.length;
        modal.setStatus(`Adding ${total} track${total !== 1 ? 's' : ''} to map\u2026`);
        modal.setProgress(0, total);
        for (let i = 0; i < total; i++) {
            extracted[i].filename = file.name;
            tracks.push(extracted[i]);
            map.addTrack(extracted[i]);
            if ((i + 1) % 25 === 0 || i === total - 1) {
                modal.setProgress(i + 1, total);
                await new Promise(r => setTimeout(r, 0));
            }
        }
        modal.addSuccess();
    };

    const handleFile = async file => {
        try {
            if (/\.jpe?g$/i.test(file.name)) {
                return await handleImage(file);
            }
            return await handleTrackFile(file);
        } catch (err) {
            console.error(err);
            modal.addFailure({name: file.name, error: err});
        }
    };

    Promise.all(files.map(handleFile)).then(() => {
        map.center();
        modal.finished();
    });
}

function handleDragOver(evt) {
    evt.dataTransfer.dropEffect = 'copy';
    evt.stopPropagation();
    evt.preventDefault();
}


function buildUploadModal(numFiles) {
    let numLoaded = 0;
    let failures = [];
    let status = '';
    let progressValue = 0;
    let progressMax = 0;

    const failureStr = () => failures.length
        ? `, <span class='failures'>${failures.length} failed</span>`
        : '';

    const getModalContent = () => `
        <h1>Reading files...</h1>
        <p>${numLoaded} loaded${failureStr()} of <b>${numFiles}</b></p>
        ${status ? `<p class="upload-status">${status}</p>` : ''}
        ${progressMax > 0
            ? `<progress id="upload-progress" value="${progressValue}" max="${progressMax}"></progress>`
            : ''}`;

    let modal = picoModal({
        content: getModalContent(),
        escCloses: false,
        overlayClose: false,
        overlayStyles: styles => {
            styles.opacity = 0.1;
        },
    });

    modal.afterCreate(() => {
        modal.closeElem().style.display = 'none';
    });

    modal.afterClose(() => modal.destroy());

    modal.setContent = body => {
        Array.from(modal.modalElem().childNodes).forEach(child => {
            if (child !== modal.closeElem()) {
                modal.modalElem().removeChild(child);
            }
        });

        modal.modalElem().insertAdjacentHTML('afterbegin', body);
    };

    modal.setStatus = text => {
        status = text;
        modal.setContent(getModalContent());
    };

    modal.setProgress = (value, max) => {
        progressValue = value;
        progressMax = max;
        modal.setContent(getModalContent());
    };

    modal.addFailure = failure => {
        failures.push(failure);
        status = '';
        progressMax = 0;
        modal.setContent(getModalContent());
    };

    modal.addSuccess = () => {
        numLoaded++;
        status = '';
        progressMax = 0;
        modal.setContent(getModalContent());
    };

    modal.finished = () => {
        if (failures.length === 0) {
            return modal.close();
        }

        let failedItems = failures.map(failure => `<li>${failure.name}</li>`);
        modal.setContent(`
            <h1>Files loaded</h1>
            <p>
                Loaded ${numLoaded},
                <span class="failures">
                    ${failures.length} failure${failures.length === 1 ? '' : 's'}:
                </span>
            </p>
            <ul class="failures">${failedItems.join('')}</ul>`);
        modal.closeElem().style.display = '';
        modal.options({
            escCloses: true,
            overlayClose: true,
        });
    };

    return modal;
}


export function buildSettingsModal(tracks, opts, updateCallback) {
    let overrideExisting = opts.lineOptions.overrideExisting ? 'checked' : '';

    if (tracks.length > 0) {
        let allSameColor = tracks.every(({line}) => {
            return line.options.color === tracks[0].line.options.color;
        });

        if (!allSameColor) {
            overrideExisting = false;
        } else {
            opts.lineOptions.color = tracks[0].line.options.color;
        }
    }

    let detect = opts.lineOptions.detectColors ? 'checked' : '';
    let themes = AVAILABLE_THEMES.map(t => {
        let selected = (t === opts.theme) ? 'selected' : '';
        return `<option ${selected} value="${t}">${t}</option>`;
    });

    let modalContent = `
<h3>Options</h3>

<form id="settings">
    <span class="form-row">
        <label>Theme</label>
        <select name="theme">
            ${themes}
        </select>
    </span>

    <fieldset class="form-group">
        <legend>GPS Track Options</legend>

        <div class="row">
            <label>Color</label>
            <input name="color" type="color" value=${opts.lineOptions.color}>
        </div>

        <div class="row">
            <label>Opacity</label>
            <input name="opacity" type="range" min=0 max=1 step=0.01
                value=${opts.lineOptions.opacity}>
        </div>

        <div class="row">
            <label>Width</label>
            <input name="weight" type="number" min=1 max=100
                value=${opts.lineOptions.weight}>
        </div>

    </fieldset>

    <fieldset class="form-group">
        <legend>Image Marker Options</legend>

        <div class="row">
            <label>Color</label>
            <input name="markerColor" type="color" value=${opts.markerOptions.color}>
        </div>

        <div class="row">
            <label>Opacity</label>
            <input name="markerOpacity" type="range" min=0 max=1 step=0.01
                value=${opts.markerOptions.opacity}>
        </div>

        <div class="row">
            <label>Width</label>
            <input name="markerWeight" type="number" min=1 max=100
                value=${opts.markerOptions.weight}>
        </div>

        <div class="row">
            <label>Radius</label>
            <input name="markerRadius" type="number" min=1 max=100
                value=${opts.markerOptions.radius}>
        </div>

    </fieldset>

    <span class="form-row">
        <label>Override existing tracks</label>
        <input name="overrideExisting" type="checkbox" ${overrideExisting}>
    </span>

    <span class="form-row">
        <label>Detect color from activity type</label>
        <input name="detectColors" type="checkbox" ${detect}>
    </span>
</form>`;

    let modal = picoModal({
        content: modalContent,
        closeButton: true,
        escCloses: true,
        overlayClose: true,
        overlayStyles: (styles) => {
            styles.opacity = 0.1;
        },
    });

    let applyOptions = () => {
        let elements = document.getElementById('settings').elements;
        let options = Object.assign({}, opts);

        for (let opt of ['theme']) {
            options[opt] = elements[opt].value;
        }

        for (let opt of ['color', 'weight', 'opacity']) {
            options.lineOptions[opt] = elements[opt].value;
        }

        for (let opt of ['markerColor', 'markerWeight', 'markerOpacity', 'markerRadius']) {
            let optionName = opt.replace('marker', '').toLowerCase();
            options.markerOptions[optionName] = elements[opt].value;
        }

        for (let opt of ['overrideExisting', 'detectColors']) {
            options.lineOptions[opt] = elements[opt].checked;
        }

        updateCallback(options);
    };

    modal.afterClose((modal) => {
        applyOptions();
        modal.destroy();
    });

    modal.afterCreate(() => {
        let elements = document.getElementById('settings').elements;
        for (let opt of ['theme', 'color', 'weight', 'opacity', 'markerColor',
            'markerWeight', 'markerOpacity', 'markerRadius']) {
            elements[opt].addEventListener('change', applyOptions);
        }
    });


    return modal;
}

export function buildFilterModal(tracks, filters, finishCallback) {
    let maxDate = new Date().toISOString().split('T')[0];
    let modalContent = `
<h3>Filter Displayed Tracks</h3>

<form id="settings">
    <span class="form-row">
        <label for="minDate">Start date:</label>
        <input type="date" id="minDate" name="minDate"
            value="${filters.minDate || ''}"
            min="1990-01-01"
            max="${maxDate}">
    </span>

    <span class="form-row">
        <label for="maxDate">End date:</label>
        <input type="date" id="maxDate" name="maxDate"
            value="${filters.maxDate || ''}"
            min="1990-01-01"
            max="${maxDate}">
    </span>
</form>`;

    let modal = picoModal({
        content: modalContent,
        closeButton: true,
        escCloses: true,
        overlayClose: true,
        overlayStyles: (styles) => {
            styles.opacity = 0.1;
        },
    });

    modal.afterClose((modal) => {
        let elements = document.getElementById('settings').elements;
        let updated = Object.assign({}, filters);

        for (let key of ['minDate', 'maxDate']) {
            updated[key] = elements[key].value;
        }

        finishCallback(updated);
        modal.destroy();
    });

    return modal;
}

export function showModal(type) {
    let modal = picoModal({
        content: MODAL_CONTENT[type],
        overlayStyles: (styles) => {
            styles.opacity = 0.01;
        },
    });

    modal.show();
    return modal;
}


const INTRO_MODAL_SEEN_KEY = 'intro-modal-seen';

export function initialize(map) {
    let displayIntroModal = true;

    if (window.sessionStorage.getItem(INTRO_MODAL_SEEN_KEY) !== null) {
        displayIntroModal = false;
    } else {
        window.sessionStorage.setItem(INTRO_MODAL_SEEN_KEY, 'true');
    }

    let modal = displayIntroModal ? showModal('help') : null;

    window.addEventListener('dragover', handleDragOver, false);
    window.addEventListener('drop', e => {
        if (displayIntroModal && !modal.destroyed) {
            modal.destroy();
            modal.destroyed = true;
        }
        handleFileSelect(map, e);
    }, false);
}
