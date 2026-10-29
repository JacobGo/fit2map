use chrono::Utc;
use fitparser::profile::MesgNum;
use fitparser::Value;
use flate2::{write::GzEncoder, Compression};
use rayon::prelude::*;
use std::{
    collections::HashSet,
    env,
    fs::{self, File},
    io::{BufWriter, Write},
    path::PathBuf,
};

const SEMICIRCLES: f64 = 180.0 / 2_147_483_648.0;

fn decode(path: &PathBuf) -> (Vec<[f64; 2]>, Option<String>) {
    let mut file = match File::open(path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("open {}: {e}", path.display());
            return (vec![], None);
        }
    };

    let data = match fitparser::from_reader(&mut file) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("decode {}: {e}", path.display());
            return (vec![], None);
        }
    };

    let mut pts: Vec<[f64; 2]> = Vec::new();
    let mut seen = HashSet::<[i32; 2]>::new();
    let mut first_ts: Option<String> = None;

    for rec in data {
        if rec.kind() != MesgNum::Record {
            continue;
        }

        let mut lat: Option<i32> = None;
        let mut lon: Option<i32> = None;
        let mut ts: Option<String> = None;

        for field in rec.fields() {
            match (field.name(), field.value()) {
                ("position_lat",  Value::SInt32(v))    => lat = Some(*v),
                ("position_long", Value::SInt32(v))    => lon = Some(*v),
                ("timestamp",     Value::Timestamp(dt)) => {
                    ts = Some(dt.with_timezone(&Utc).format("%Y-%m-%dT%H:%M:%SZ").to_string());
                }
                _ => {}
            }
        }

        if let (Some(lat), Some(lon)) = (lat, lon) {
            if seen.insert([lat, lon]) {
                if first_ts.is_none() {
                    first_ts = ts;
                }
                pts.push([lat as f64 * SEMICIRCLES, lon as f64 * SEMICIRCLES]);
            }
        }
    }

    (pts, first_ts)
}

fn write_gpx_gz(path: &PathBuf, tracks: &[(Vec<[f64; 2]>, Option<String>)]) -> std::io::Result<()> {
    let file = File::create(path)?;
    let mut gz = GzEncoder::new(BufWriter::new(file), Compression::best());

    gz.write_all(b"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")?;
    gz.write_all(
        b"<gpx version=\"1.1\" creator=\"fit2map\" xmlns=\"http://www.topografix.com/GPX/1/1\">\n",
    )?;

    for (track, timestamp) in tracks {
        gz.write_all(b"  <trk>\n    <trkseg>\n")?;
        let mut first = true;
        for [lat, lon] in track {
            if first {
                first = false;
                if let Some(ts) = timestamp {
                    write!(gz, "      <trkpt lat=\"{:.7}\" lon=\"{:.7}\"><time>{ts}</time></trkpt>\n", lat, lon)?;
                    continue;
                }
            }
            write!(gz, "      <trkpt lat=\"{:.7}\" lon=\"{:.7}\"/>\n", lat, lon)?;
        }
        gz.write_all(b"    </trkseg>\n  </trk>\n")?;
    }

    gz.write_all(b"</gpx>\n")?;
    gz.finish()?;
    Ok(())
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        eprintln!("Usage: fit2map <input-dir> <output.gpx.gz>");
        std::process::exit(1);
    }

    let input_dir = PathBuf::from(&args[1]);
    let output_path = PathBuf::from(&args[2]);

    if !input_dir.is_dir() {
        eprintln!("Error: {} is not a directory", input_dir.display());
        std::process::exit(1);
    }

    let mut fit_files: Vec<PathBuf> = match fs::read_dir(&input_dir) {
        Ok(dir) => dir
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| matches!(p.extension().and_then(|s| s.to_str()), Some("fit")))
            .collect(),
        Err(e) => {
            eprintln!("Error reading {}: {e}", input_dir.display());
            std::process::exit(1);
        }
    };

    if fit_files.is_empty() {
        eprintln!("No .fit files found in {}", input_dir.display());
        std::process::exit(1);
    }

    fit_files.sort(); // deterministic output order

    eprintln!("Decoding {} .fit files...", fit_files.len());

    // Parallel decode — rayon preserves input order in collect()
    let tracks: Vec<(Vec<[f64; 2]>, Option<String>)> = fit_files
        .par_iter()
        .filter_map(|path| {
            let (pts, ts) = decode(path);
            if pts.is_empty() { None } else { Some((pts, ts)) }
        })
        .collect();

    let total_pts: usize = tracks.iter().map(|(t, _)| t.len()).sum();
    eprintln!(
        "Writing {} tracks, {} points → {}",
        tracks.len(),
        total_pts,
        output_path.display()
    );

    if let Err(e) = write_gpx_gz(&output_path, &tracks) {
        eprintln!("Error writing output: {e}");
        std::process::exit(1);
    }
}
