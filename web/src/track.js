// This file is adapted from taterbase/gpx-parser
//
// https://github.com/taterbase/gpx-parser
//
// See https://www.topografix.com/gpx/1/1 for details on the schema for
// GPX files.

import FitParser from 'fit-file-parser';
import IGCParser from 'igc-parser';
import { parseSkizFile } from 'skiz-parser';

function parseXML(xmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString.trimStart(), 'text/xml');

    const parseError = doc.querySelector('parsererror');
    if (parseError) {
        throw new Error('XML parsing error: ' + parseError.textContent);
    }

    return doc;
}

function getTextContent(element, tagName) {
    const el = element.querySelector(tagName);
    return el ? el.textContent : null;
}

function queryElements(element, tagName) {
    return Array.from(element.querySelectorAll(tagName));
}

// Regex-based attribute extractors (order-independent)
const LAT_RE = /\blat="([^"]+)"/;
const LON_RE = /\blon="([^"]+)"/;
const TIME_RE = /<time>([^<]+)<\/time>/;
// Matches <trkpt> / <rtept> — captures attrs and optional inner content
const TRKPT_RE = /<trkpt\b([^/\n>]*)(?:\/>|>([\s\S]*?)<\/trkpt>)/g;
const RTEPT_RE = /<rtept\b([^/\n>]*)(?:\/>|>([\s\S]*?)<\/rtept>)/g;

function parsePts(segText, ptRe) {
    const points = [];
    let timestamp;
    ptRe.lastIndex = 0;
    let m;
    while ((m = ptRe.exec(segText)) !== null) {
        const latM = LAT_RE.exec(m[1]);
        const lonM = LON_RE.exec(m[1]);
        if (!latM || !lonM) continue;
        points.push({ lat: parseFloat(latM[1]), lng: parseFloat(lonM[1]) });
        if (!timestamp && m[2]) {
            const tm = TIME_RE.exec(m[2]);
            if (tm) timestamp = new Date(tm[1]);
        }
    }
    return { points, timestamp };
}

function parseTrkBlock(trkText) {
    const nameM = /<name>([^<]*)<\/name>/i.exec(trkText);
    const typeM = /<type>([^<]*)<\/type>/i.exec(trkText);
    const name = nameM ? nameM[1] : 'untitled';
    const activityType = typeM ? typeM[1].trim() : null;
    const result = [];
    let pos = 0;
    while ((pos = trkText.indexOf('<trkseg>', pos)) !== -1) {
        const end = trkText.indexOf('</trkseg>', pos);
        if (end === -1) break;
        const { points, timestamp } = parsePts(trkText.slice(pos + 8, end), TRKPT_RE);
        if (points.length > 0) result.push({ timestamp, points, name, activityType });
        pos = end + 9;
    }
    return result;
}

function parseRteBlock(rteText) {
    const nameM = /<name>([^<]*)<\/name>/i.exec(rteText);
    const name = nameM ? nameM[1] : 'untitled';
    const { points, timestamp } = parsePts(rteText, RTEPT_RE);
    return points.length > 0 ? [{ timestamp, points, name }] : [];
}

async function extractGPXTracks(text, onProgress) {
    const blocks = [];
    for (const [open, close, type] of [['<trk>', '</trk>', 'trk'], ['<rte>', '</rte>', 'rte']]) {
        let pos = 0;
        while ((pos = text.indexOf(open, pos)) !== -1) {
            const end = text.indexOf(close, pos);
            if (end === -1) break;
            blocks.push({ pos, end: end + close.length, type });
            pos = end + close.length;
        }
    }
    if (blocks.length === 0) throw new Error('Unexpected gpx file format.');
    blocks.sort((a, b) => a.pos - b.pos);

    const tracks = [];
    for (let i = 0; i < blocks.length; i++) {
        const { pos, end, type } = blocks[i];
        const parsed = type === 'trk'
            ? parseTrkBlock(text.slice(pos, end))
            : parseRteBlock(text.slice(pos, end));
        tracks.push(...parsed);
        if ((i + 1) % 25 === 0 || i === blocks.length - 1) {
            onProgress && onProgress(i + 1, blocks.length);
            await new Promise(r => setTimeout(r, 0));
        }
    }
    return tracks;
}

function extractTCXTracks(tcx, name) {
    const activities = queryElements(tcx, 'Activity');

    if (activities.length === 0) {
        console.log('TCX file has no activities!', tcx);
        throw new Error('Unexpected tcx file format.');
    }

    const parsedTracks = [];
    const activityType = activities[0].getAttribute('Sport') || null;

    for (const activity of activities) {
        const laps = queryElements(activity, 'Lap');

        for (const lap of laps) {
            const tracks = queryElements(lap, 'Track');
            if (tracks.length === 0) {
                continue;
            }

            for (const track of tracks) {
                const trackPoints = queryElements(track, 'Trackpoint')
                    .filter(tp => tp.querySelector('Position'));

                let timestamp;
                const points = [];

                for (const trkpt of trackPoints) {
                    const timeEl = trkpt.querySelector('Time');
                    if (timeEl && timeEl.textContent) {
                        timestamp = new Date(timeEl.textContent);
                    }

                    const position = trkpt.querySelector('Position');
                    if (position) {
                        const latEl = position.querySelector('LatitudeDegrees');
                        const lngEl = position.querySelector('LongitudeDegrees');

                        if (latEl && lngEl) {
                            points.push({
                                lat: parseFloat(latEl.textContent),
                                lng: parseFloat(lngEl.textContent),
                            });
                        }
                    }
                }

                if (points.length > 0) {
                    parsedTracks.push({ timestamp, points, name, activityType });
                }
            }
        }
    }

    return parsedTracks;
}

function extractFITTracks(fit, name) {
    if (!fit.records || fit.records.length === 0) {
        console.log('FIT file has no records!', fit);
        throw new Error('Unexpected FIT file format.');
    }

    let timestamp;
    const points = [];
    const activityType = fit.sport ? fit.sport.sport.toLowerCase() : null;
    for (const record of fit.records) {
        if (record.position_lat && record.position_long) {
            points.push({
                lat: record.position_lat,
                lng: record.position_long,
            });
        }
        record.timestamp && (timestamp = record.timestamp);
    }

    return points.length > 0 ? [{ timestamp, points, name, activityType }] : [];
}

function extractIGCTracks(igc) {
    const points = [];
    let timestamp = null;
    for (const fix of igc.fixes) {
        points.push({
            lat: fix.latitude,
            lng: fix.longitude,
        });
        timestamp = timestamp || new Date(fix.timestamp);
    }
    const name = 'igc';
    return points.length > 0 ? [{ timestamp, points, name }] : [];
}

function extractSKIZTracks(skiz) {
    const points = [];
    let timestamp = null;

    for (const node of skiz.trackNodes) {
        points.push({
            lat: node.latitude,
            lng: node.longitude,
        });

        node.timestamp && (timestamp = node.timestamp);
    }

    const name = 'skiz';
    return points.length > 0 ? [{ timestamp, points, name }] : [];
}

function decompressFile(file) {
    const stream = file
        .stream()
        .pipeThrough(new window.DecompressionStream('gzip'));
    return new Response(stream);
}

async function readFile(file, encoding, isGzipped) {
    const stream = isGzipped ? decompressFile(file) : file;
    const buffer = await stream.arrayBuffer();

    return encoding === 'text'
        ? new TextDecoder().decode(buffer)
        : buffer;
}

export default function extractTracks(file, onProgress) {
    const isGzipped = /\.gz$/i.test(file.name);
    const strippedName = file.name.replace(/\.gz$/i, '');
    const format = strippedName.split('.').pop().toLowerCase();

    switch (format) {
    case 'gpx':
    case 'tcx':
        return readFile(file, 'text', isGzipped)
            .then(text => {
                const trimmed = text.trimStart();
                if (/<gpx[\s>]/.test(trimmed)) {
                    return extractGPXTracks(trimmed, onProgress);
                } else if (/<TrainingCenterDatabase[\s>]/.test(trimmed)) {
                    return extractTCXTracks(parseXML(trimmed), strippedName);
                }
                throw new Error('Invalid file type.');
            });

    case 'fit':
        return readFile(file, 'binary', isGzipped)
            .then(contents => new Promise((resolve, reject) => {
                const parser = new FitParser({
                    force: true,
                    mode: 'list',
                });

                parser.parse(contents, (err, result) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(extractFITTracks(result, strippedName));
                    }
                });
            }));

    case 'igc':
        return readFile(file, 'text', isGzipped)
            .then(textContents => new Promise((resolve, reject) => {
                try {
                    resolve(extractIGCTracks(IGCParser.parse(textContents, {lenient: true})));
                } catch(err) {
                    reject(err);
                }
            }));

    case 'skiz':
        return readFile(file, 'binary', isGzipped)
            .then(contents => new Promise((resolve, reject) => {
                parseSkizFile(contents, (err, result) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(extractSKIZTracks(result));
                    }
                });
            }));

    default:
        throw `Unsupported file format: ${format}`;
    }
}
