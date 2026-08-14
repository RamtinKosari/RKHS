"""
Personal Cinema module for RKHS.

Scans Videos/Cinema/ on the server, exposing a JSON library and persistent
per-user state (ratings, notes, watch status, progress) backed by a JSON
file on disk. Also provides range-aware video streaming and SRT -> VTT
subtitle conversion for HTML5 <track> playback.
"""

import os
import re
import json
import sys
import time
import hashlib
import mimetypes
import urllib.parse
import logging
import shutil
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Iterable

from flask import Blueprint, jsonify, request, send_file, Response, abort
from werkzeug.utils import secure_filename

# ------------------------------------------------------------------ #
# Configuration
# ------------------------------------------------------------------ #

# Allow importing the app module's constants when this module is loaded
# from app.py. We re-read them lazily inside helpers so test-time overrides
# also work.
_DEFAULT_ROOTS = ("Videos/Cinema", "Videos/Documentary")
_VIDEO_EXTS = {"mp4", "mkv", "webm", "mov", "m4v", "avi"}
_IMAGE_EXTS = {"jpg", "jpeg", "png", "webp"}
_SUBTITLE_EXTS = ("srt", "vtt")
# Maximum user-uploaded screenshots allowed per movie / series. Enforced
# by ``POST /screenshots/<media_id>`` so the limit is authoritative even
# if a client tries to bypass the UI.
_SCREENSHOT_MAX_PER_MEDIA = 6
_HLS_DIR_EXT = ".hls"
_HLS_PLAYLIST_NAME = "index.m3u8"
_HLS_INIT_NAME = "init.mp4"
_HLS_SEGMENT_PATTERN = "seg-%05d.m4s"
_HLS_SEGMENT_TIME = 4  # seconds per HLS segment
# Managed cache for remuxed MP4s and live HLS transcodes. Lives under the
# upload folder so it can be size-capped and LRU-evicted independently of
# the source library. Nothing in here is precious: stale entries are reclaimed
# automatically and the whole tree can be deleted safely.
_CACHE_DIR_NAME = ".cache/cinema"
_CACHE_DEFAULT_MAX_BYTES = 50 * 1024 * 1024 * 1024  # 50 GB
_CACHE_MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024      # leave 2 GB headroom
_CACHE_LOCK = threading.Lock()
# In-flight locks so concurrent requests for the same HLS segment share
# one ffmpeg transcode instead of racing to write the same tmp file.
_SEGMENT_INFLIGHT_LOCKS: dict[str, threading.Lock] = {}
_SEGMENT_INFLIGHT_LOCK = threading.Lock()
# Cached keyframe timestamps per source. Probing is one-time per source
# and lets us seek each on-demand segment to an exact keyframe boundary.
_KEYFRAME_CACHE: dict[str, list[float]] = {}
_KEYFRAME_CACHE_LOCK = threading.Lock()
# Filenames the scanner should always ignore: our own HLS artifacts,
# dotfiles, and macOS / Windows metadata.
_IGNORED_BASENAMES = {".ds_store", "thumbs.db"}
_remux_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="cinema-remux")
_remux_jobs: dict[str, dict] = {}
_remux_lock = __import__("threading").Lock()
# Persistent MKV→MP4 conversion jobs. The output is a sibling ``.mp4`` next
# to the source so the scanner picks it up after the next refresh. Hardware
# acceleration is detected at module load (NVIDIA NVENC → VA-API → QSV →
# VideoToolbox → libx264 software).
_convert_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="cinema-convert")
_convert_jobs: dict[str, dict] = {}
_convert_lock = __import__("threading").Lock()
_HW_ENCODER: str | None = None
_HW_ENCODER_CHECKED = False
# Serialises the (write-tmp, os.replace) pair in StateStore._save() so
# concurrent Flask threads can't clobber each other's tmp file.
_STATE_SAVE_LOCK = threading.Lock()
_ffmpeg_checked = False
_ffmpeg_available = False
_ffprobe_available = False

mimetypes.add_type("video/x-matroska", ".mkv")
mimetypes.add_type("video/x-matroska", ".m4v")
mimetypes.add_type("video/webm", ".webm")
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("image/jpeg", ".jpg")
mimetypes.add_type("image/jpeg", ".jpeg")

# Friendly category names that map subfolder names to MediaType slugs.
CATEGORY_ALIASES = {
    "movies": "movie",
    "movie": "movie",
    "films": "movie",
    "film": "movie",
    "cinema": "movie",
    "series": "series",
    "tv": "series",
    "tvshows": "series",
    "tv-shows": "series",
    "shows": "series",
    "animations": "animation",
    "animation": "animation",
    "anime": "animation",
    "animated": "animation",
    "documentaries": "documentary",
    "documentary": "documentary",
    "docs": "documentary",
    "shorts": "short",
    "short": "short",
    "shortfilms": "short",
    "short-films": "short",
}


def _slugify(text: str) -> str:
    """Generate a URL-safe id from a string."""
    text = (text or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = text.strip("-")
    return text or "item"


def _parse_title(folder_name: str) -> dict:
    """Parse movie/show titles from folder or file names.

    Supports the following conventions, in order:
      1. ``Title (YYYY)``             -> year at end, parenthesized
      2. ``Title YYYY``               -> year at end, space-separated
      3. ``Title.YYYY.<anything>``    -> year anywhere, separated by ``.`` / ``_`` / space
      4. ``Title YYYY <anything>``    -> year anywhere mid-string
    The portion before the year becomes the title; the year is captured as int.
    """
    name = (folder_name or "").strip()
    year = None
    title = name

    m = re.search(r"\((\d{4})\)\s*$", name)
    if m:
        year = int(m.group(1))
        title = name[: m.start()].strip()
    else:
        m = re.search(r"[\s_](\d{4})\s*$", name)
        if m:
            year = int(m.group(1))
            title = name[: m.start()].strip()
        else:
            # Year anywhere in the string (between word boundaries / dots /
            # underscores). Prefer the first 4-digit number that looks like a
            # release year (1900-2099).
            m = re.search(r"[.\s_\-]((?:19|20)\d{2})[.\s_\-]", name)
            if m:
                year = int(m.group(1))
                title = name[: m.start()].strip()

    # Replace dots/underscores that Plex-style libraries frequently use.
    title = title.replace(".", " ").replace("_", " ").strip()
    title = re.sub(r"\s+", " ", title)
    title = title.strip("-")
    if not title:
        title = name
    return {"title": title, "year": year}


def _category_type(category: str) -> str:
    key = (category or "").strip().lower().replace("_", "").replace(" ", "")
    return CATEGORY_ALIASES.get(key, "other")


def _probe_tools() -> tuple[bool, bool]:
    global _ffmpeg_checked, _ffmpeg_available, _ffprobe_available
    if not _ffmpeg_checked:
        _ffmpeg_available = shutil.which("ffmpeg") is not None
        _ffprobe_available = shutil.which("ffprobe") is not None
        _ffmpeg_checked = True
        if not (_ffmpeg_available and _ffprobe_available):
            logging.getLogger(__name__).warning("Cinema transcoding unavailable: ffmpeg/ffprobe missing")
    return _ffmpeg_available, _ffprobe_available


def _detect_hw_encoder() -> str | None:
    """Return the best available H.264 hardware encoder, or ``None``.

    ffmpeg lists every encoder compiled into the binary even when no GPU is
    attached, so we additionally probe for the device entry / driver that
    backs each one. The result is cached at module scope so we don't spawn
    extra subprocesses on every convert request.
    """
    global _HW_ENCODER, _HW_ENCODER_CHECKED
    if _HW_ENCODER_CHECKED:
        return _HW_ENCODER
    _HW_ENCODER_CHECKED = True
    if not _ffmpeg_available:
        _HW_ENCODER = None
        return None
    candidates: list[tuple[str, bool]] = []

    def _enc_listed(name: str) -> bool:
        try:
            r = subprocess.run(
                ["ffmpeg", "-hide_banner", "-encoders"],
                capture_output=True, text=True, timeout=10,
            )
            # Look for the encoder as its own token (preceded by a space or
            # the start of a line, followed by whitespace).
            return (
                f" {name} " in r.stdout
                or f"\n{name} " in r.stdout
            )
        except (OSError, subprocess.SubprocessError):
            return False

    def _has_vaapi_device() -> bool:
        # Modern Linux exposes one render node per GPU.
        try:
            return any(
                os.path.exists(f"/dev/dri/renderD{i}") for i in range(128)
            )
        except OSError:
            return False

    def _has_nvidia() -> bool:
        # Either the proprietary driver nodes are present, or ``nvidia-smi``
        # is on PATH and answers. ``nvidia-smi`` alone is the most reliable.
        if os.path.exists("/dev/nvidia0"):
            return True
        return shutil.which("nvidia-smi") is not None

    if _has_nvidia() and _enc_listed("h264_nvenc"):
        candidates.append(("h264_nvenc", True))
    if _has_vaapi_device() and _enc_listed("h264_vaapi"):
        candidates.append(("h264_vaapi", True))
    if _has_vaapi_device() and _enc_listed("h264_qsv"):
        candidates.append(("h264_qsv", True))
    if sys.platform == "darwin" and _enc_listed("h264_videotoolbox"):
        candidates.append(("h264_videotoolbox", True))

    for name, _ in candidates:
        _HW_ENCODER = name
        return name
    _HW_ENCODER = None
    return None


def _probe_video(path: str) -> dict:
    """Probe the first video and first audio stream of ``path``.

    Returns codec, pixel format, container format and a playback strategy
    decision. The strategy is decided at scan time so the UI and the /play
    endpoint never have to guess.
    """
    _probe_tools()
    if not _ffprobe_available:
        return {}
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=codec_name,pix_fmt",
                "-show_entries", "format=format_name,duration",
                "-of", "json", path,
            ],
            capture_output=True, text=True, timeout=15, check=True,
        )
        data = json.loads(result.stdout)
        stream = (data.get("streams") or [{}])[0]
        fmt_info = data.get("format") or {}
        codec = stream.get("codec_name")
        pix_fmt = stream.get("pix_fmt")
        formats = {f.strip().lower() for f in (fmt_info.get("format_name") or "").split(",")}

        audio = _probe_audio(path)
        strategy = _playback_strategy(path, codec, pix_fmt, formats, audio)
        return {
            "videoCodec": codec,
            "pixelFormat": pix_fmt,
            "audioCodec": audio.get("codec"),
            "containerFormat": fmt_info.get("format_name"),
            "duration": _safe_float(fmt_info.get("duration")),
            "browserFriendly": strategy in ("direct", "remux"),
            "playbackStrategy": strategy,
        }
    except (OSError, subprocess.SubprocessError, ValueError, json.JSONDecodeError):
        return {}


def _probe_audio(path: str) -> dict:
    """Probe the first audio stream. We only need the codec to decide whether
    it can be copied through during a remux."""
    _probe_tools()
    if not _ffprobe_available:
        return {}
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "json", path],
            capture_output=True, text=True, timeout=10, check=True,
        )
        stream = (json.loads(result.stdout).get("streams") or [{}])[0]
        return {"codec": stream.get("codec_name")}
    except (OSError, subprocess.SubprocessError, ValueError, json.JSONDecodeError):
        return {}


def _probe_keyframes(path: str) -> list[float]:
    """Return sorted video keyframe presentation timestamps for ``path``.

    The list is cached per source so on-demand segment transcoding can seek
    to the exact previous keyframe and then decode forward to the segment
    boundary. This eliminates the timestamp drift that makes seeking freeze.
    """
    cached = _KEYFRAME_CACHE.get(path)
    if cached is not None:
        return cached
    _probe_tools()
    if not _ffprobe_available:
        return []
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-skip_frame", "nokey",
                "-show_entries", "frame=pkt_pts_time",
                "-of", "csv=p=0",
                path,
            ],
            capture_output=True, text=True, timeout=60, check=True,
        )
        times: list[float] = []
        for line in result.stdout.strip().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                times.append(float(line))
            except ValueError:
                continue
        times.sort()
        with _KEYFRAME_CACHE_LOCK:
            _KEYFRAME_CACHE[path] = times
        return times
    except (OSError, subprocess.SubprocessError, ValueError) as exc:
        logging.getLogger(__name__).warning(f"Keyframe probe failed for {path}: {exc}")
        return []


def _previous_keyframe(path: str, position: float) -> float:
    """Return the largest keyframe timestamp <= ``position`` seconds."""
    keyframes = _probe_keyframes(path)
    prev = 0.0
    for kf in keyframes:
        if kf <= position:
            prev = kf
        else:
            break
    return prev


def _safe_float(value) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


# Codecs the browser can decode inside an MP4/MOV container via MSE or the
# native <video> element. HEVC is intentionally excluded here: it is handled
# as a separate "remux-hevc" path because support is browser-dependent.
_BROWSER_VIDEO_CODECS = {"h264", "vp8", "vp9", "av1"}
# Audio codecs that survive a -c:a copy remux and still play in browsers.
_BROWSER_AUDIO_CODECS = {"aac", "mp3", "opus", "flac", "vorbis", "mp2"}
# Containers that the browser can natively demux (no remux needed).
_BROWSER_CONTAINERS = {"mov,mp4,m4a,3gp,3g2,mj2", "mp4", "mov", "m4v", "webm"}


def _playback_strategy(path: str, video_codec: str | None, pix_fmt: str | None, formats: set[str], audio: dict) -> str:
    """Decide how this file should be served.

    Returns one of:
      - "direct":  browser can play the source as-is (MP4/MOV/WebM + decodable codecs).
      - "remux":   video/audio codecs are browser-decodable but the container
                   isn't (e.g. MKV with H.264 + AAC). A fast -c copy remux to
                   fragmented MP4 makes it playable.
      - "remux-hevc": HEVC video that modern Chrome/Safari can decode when
                   repackaged into MP4. May still fail on some browsers.
      - "transcode": codecs are unsupported (VC-1, MPEG-2, DTS audio, etc.).
                   Requires a full ffmpeg transcode to H.264/AAC HLS.

    The container decision is based on the file extension, not on ffprobe's
    ``format_name`` (which lists compatible demuxers — e.g. MKV files often
    report ``matroska,webm`` even though they are not WebM).
    """
    ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
    video_ok = video_codec in _BROWSER_VIDEO_CODECS and not (pix_fmt or "").endswith("10le")
    audio_codec = (audio.get("codec") or "").lower()
    audio_ok = audio_codec in _BROWSER_AUDIO_CODECS or not audio_codec
    container_ok = ext in {"mp4", "m4v", "mov", "webm"}

    if video_ok and audio_ok and container_ok:
        return "direct"
    # HEVC 8-bit can play in modern Chrome (147+) / Safari when repackaged
    # into MP4. 10-bit/HDR HEVC is not broadly browser-decodable, so fall
    # back to a full transcode.
    if video_codec == "hevc" and audio_ok and not (pix_fmt or "").endswith("10le"):
        return "remux-hevc"
    if video_ok and audio_ok and not container_ok:
        return "remux"
    return "transcode"


class CacheManager:
    """LRU-managed cache for remuxed MP4s and live HLS transcodes.

    Keys are derived from the source path + mtime + size, so renaming or
    modifying a source invalidates stale entries automatically. Outputs are
    written into ``<upload_folder>/.cache/cinema/`` and evicted by least-
    recent access time when the total footprint exceeds the configured cap.
    """

    def __init__(self, upload_folder: str, max_bytes: int | None = None):
        self.upload_folder = os.path.abspath(upload_folder)
        self.root = os.path.join(self.upload_folder, _CACHE_DIR_NAME)
        self.max_bytes = max_bytes if max_bytes is not None else _CACHE_DEFAULT_MAX_BYTES
        os.makedirs(self.root, exist_ok=True)

    def _source_fingerprint(self, source: str) -> str:
        """Stable cache key for a source file."""
        try:
            stat = os.stat(source)
            token = f"{os.path.abspath(source)}|{stat.st_mtime}|{stat.st_size}"
        except OSError:
            token = os.path.abspath(source)
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def remux_path(self, source: str) -> tuple[str, str]:
        """Return (cache_hash, absolute_path) for the remuxed MP4 of ``source``."""
        key = self._source_fingerprint(source)
        return key, os.path.join(self.root, f"{key}.mp4")

    def hls_dir(self, source: str) -> tuple[str, str]:
        """Return (cache_hash, absolute_dir) for the HLS transcode of ``source``."""
        key = self._source_fingerprint(source)
        return key, os.path.join(self.root, "hls", key)

    def metadata_path(self, source: str) -> str:
        """Sidecar JSON that records source path/mtime/size for validation."""
        key = self._source_fingerprint(source)
        return os.path.join(self.root, f"{key}.json")

    def is_valid(self, source: str, path: str) -> bool:
        """True if ``path`` exists and the sidecar matches the current source."""
        if not os.path.exists(path):
            return False
        meta_path = self.metadata_path(source)
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
            stat = os.stat(source)
            return (
                meta.get("source") == os.path.abspath(source)
                and meta.get("mtime") == stat.st_mtime
                and meta.get("size") == stat.st_size
            )
        except (OSError, json.JSONDecodeError, TypeError):
            return False

    def write_metadata(self, source: str) -> None:
        try:
            stat = os.stat(source)
            meta = {
                "source": os.path.abspath(source),
                "mtime": stat.st_mtime,
                "size": stat.st_size,
                "createdAt": int(time.time()),
            }
            with open(self.metadata_path(source), "w", encoding="utf-8") as f:
                json.dump(meta, f, indent=2)
        except OSError:
            pass

    def touch(self, path: str) -> None:
        """Update access time so LRU keeps hot entries around."""
        try:
            os.utime(path, None)
        except OSError:
            pass

    def _cache_entries(self) -> list[tuple[str, float, int]]:
        """List all cache files/dirs with their last access time and size."""
        entries: list[tuple[str, float, int]] = []
        for dirpath, dirnames, filenames in os.walk(self.root):
            for name in filenames + dirnames:
                full = os.path.join(dirpath, name)
                try:
                    st = os.stat(full)
                    entries.append((full, st.st_atime, st.st_size))
                except OSError:
                    continue
        return entries

    def evict_if_needed(self, required_bytes: int = 0, protected: set[str] | None = None) -> None:
        """Reclaim space until we're under the cap, keeping protected paths."""
        with _active_cache_paths_lock:
            protected = (protected or set()) | set(_active_cache_paths)
        with _CACHE_LOCK:
            total = sum(size for _, _, size in self._cache_entries())
            budget = self.max_bytes - required_bytes
            if total <= budget:
                return
            entries = [
                (path, atime, size)
                for path, atime, size in self._cache_entries()
                if path not in protected
            ]
            entries.sort(key=lambda x: x[1])
            for path, _, size in entries:
                if total <= budget:
                    break
                try:
                    if os.path.isdir(path):
                        shutil.rmtree(path)
                    else:
                        os.remove(path)
                    total -= size
                except OSError:
                    continue

    def clear_source(self, source: str) -> None:
        """Remove all cached outputs for ``source`` (useful for force restart)."""
        key = self._source_fingerprint(source)
        with _CACHE_LOCK:
            for path in [
                os.path.join(self.root, f"{key}.mp4"),
                os.path.join(self.root, f"{key}.json"),
                os.path.join(self.root, "hls", key),
            ]:
                try:
                    if os.path.isdir(path):
                        shutil.rmtree(path)
                    elif os.path.isfile(path):
                        os.remove(path)
                except OSError:
                    pass


def _cache_manager(upload_folder: str) -> CacheManager:
    return CacheManager(upload_folder)


# Paths currently being written by remux / transcode jobs. The cache manager
# refuses to evict these so concurrent jobs don't delete each other's output.
_active_cache_paths: set[str] = set()
_active_cache_paths_lock = threading.Lock()


def _protect_cache_path(path: str) -> None:
    with _active_cache_paths_lock:
        _active_cache_paths.add(path)


def _unprotect_cache_path(path: str) -> None:
    with _active_cache_paths_lock:
        _active_cache_paths.discard(path)


def _hls_dir(source: str) -> str:
    """Legacy helper: returns the source-adjacent HLS directory name.

    New code should use CacheManager.hls_dir() so transcodes live in the
    managed cache. This remains only for backward-compatible lookups.
    """
    return os.path.splitext(source)[0] + _HLS_DIR_EXT


def _hls_playlist(hls: str) -> str:
    return os.path.join(hls, _HLS_PLAYLIST_NAME)


def _kill_ffmpeg(process: "subprocess.Popen | None") -> None:
    """Best-effort terminate of a background ffmpeg. No-op if the process
    already exited or was never started."""
    if process is None:
        return
    if process.poll() is not None:
        return
    try:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                pass
    except OSError:
        pass


# ------------------------------------------------------------------ #
# Remux path (MKV/AVI/etc → fragmented MP4, -c copy)
# ------------------------------------------------------------------ #


def _start_remux(source: str, cache: CacheManager) -> "subprocess.Popen | None":
    """Start a stream-copy remux of ``source`` into a cache-resident fMP4.

    Video and audio streams are copied unchanged; only the container is
    rewritten to fragmented MP4 so the browser can demux it natively. This
    is near-instant for H.264/AAC in MKV and still very fast for HEVC.
    """
    try:
        _, out_path = cache.remux_path(source)
        cache.evict_if_needed(required_bytes=os.path.getsize(source) if os.path.isfile(source) else 0)
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        tmp_path = out_path + ".tmp"
        _protect_cache_path(tmp_path)
        _protect_cache_path(out_path)
        # Map first video and first audio. -fflags +genpts fixes timestamp
        # discontinuities common in downloaded MKVs so the fMP4 muxer doesn't
        # abort on non-monotonic DTS.
        return subprocess.Popen(
            [
                "ffmpeg", "-y", "-fflags", "+genpts", "-i", source,
                "-map", "0:v:0", "-map", "0:a?",
                "-c:v", "copy", "-c:a", "copy",
                "-movflags", "frag_keyframe+empty_moov+default_base_moof",
                "-f", "mp4", tmp_path,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
    except OSError:
        return None


def _run_remux(source: str, job_key: str, cache: CacheManager) -> None:
    """Drive the remux to completion and atomically publish the output."""
    process = _start_remux(source, cache)
    _, out_path = cache.remux_path(source)
    tmp_path = out_path + ".tmp"
    if process is None:
        _unprotect_cache_path(tmp_path)
        _unprotect_cache_path(out_path)
        with _remux_lock:
            _remux_jobs[job_key] = {"status": "error", "error": "Failed to spawn ffmpeg"}
        return
    stderr_chunks: list[bytes] = []

    def _drain_stderr() -> None:
        if process.stderr is None:
            return
        for chunk in iter(process.stderr.readline, b""):
            stderr_chunks.append(chunk)

    drain_thread = threading.Thread(target=_drain_stderr, daemon=True)
    drain_thread.start()
    try:
        rc = process.wait()
        drain_thread.join(timeout=2)
        if process.stderr is not None:
            process.stderr.close()
        stderr_text = b"".join(stderr_chunks).decode("utf-8", errors="replace").strip()
        if rc != 0:
            last_line = stderr_text.splitlines()[-1] if stderr_text else f"ffmpeg exited with code {rc}"
            raise RuntimeError(last_line)
        _, out_path = cache.remux_path(source)
        tmp_path = out_path + ".tmp"
        if os.path.isfile(tmp_path):
            os.replace(tmp_path, out_path)
            cache.write_metadata(source)
        status = {"status": "ready"}
    except (OSError, subprocess.SubprocessError, RuntimeError) as exc:
        _kill_ffmpeg(process)
        drain_thread.join(timeout=2)
        message = (str(exc) or "").strip().splitlines()
        status = {"status": "error", "error": (message[-1] if message else str(exc))[:300]}
    finally:
        _unprotect_cache_path(tmp_path)
        _unprotect_cache_path(out_path)
    with _remux_lock:
        _remux_jobs[job_key] = status


def _remux_status(source: str, cache: CacheManager, force: bool = False) -> dict:
    """Kick off (or join) the remux for ``source``. Idempotent."""
    key = source
    _, out_path = cache.remux_path(source)
    if not force and cache.is_valid(source, out_path):
        cache.touch(out_path)
        return {"status": "ready", "path": out_path}
    if force:
        cache.clear_source(source)
    with _remux_lock:
        existing = _remux_jobs.get(key)
        if existing and existing.get("status") == "running":
            return existing
        if not _ffmpeg_available:
            return {"status": "unavailable", "error": "ffmpeg is not installed"}
        _remux_jobs[key] = {"status": "running"}
        _remux_executor.submit(_run_remux, source, key, cache)
        return {"status": "queued"}


# ------------------------------------------------------------------ #
# HLS transcode path (unsupported codecs) — on-demand segments
# ------------------------------------------------------------------ #

# Instead of transcoding the whole movie up front, we generate a VOD playlist
# and transcode each 4-second segment when the player asks for it. The user can
# start watching in seconds from any position; only the segments they actually
# watch consume CPU. Segments are cached so rewinds/rewatches are instant.


def _segment_count(duration: float | None) -> int | None:
    """Number of HLS segments needed for a source of ``duration`` seconds."""
    if duration is None or duration <= 0:
        return None
    return max(1, int((duration + _HLS_SEGMENT_TIME - 0.001) // _HLS_SEGMENT_TIME))


def _segment_time_range(index: int, duration: float | None) -> tuple[float, float]:
    """Return (start, end) in seconds for segment ``index``."""
    start = index * _HLS_SEGMENT_TIME
    end = start + _HLS_SEGMENT_TIME
    if duration is not None:
        end = min(end, duration)
    return start, end


def _hls_paths(source: str, cache: CacheManager):
    """Return (hls_dir, playlist_path, init_path)."""
    _, hls = cache.hls_dir(source)
    return hls, os.path.join(hls, _HLS_PLAYLIST_NAME), os.path.join(hls, _HLS_INIT_NAME)


def _hls_segment_path(source: str, index: int, cache: CacheManager) -> str:
    hls, _, _ = _hls_paths(source, cache)
    return os.path.join(hls, _HLS_SEGMENT_PATTERN % index)


def _generate_hls_init(source: str, cache: CacheManager) -> str | None:
    """Generate the fMP4 init segment (moov) for the HLS transcode.

    This only needs to be done once per source; it contains codec headers but
    no media samples.
    """
    hls, _, init_path = _hls_paths(source, cache)
    os.makedirs(hls, exist_ok=True)
    if os.path.isfile(init_path) and os.path.getsize(init_path) > 0:
        return init_path
    tmp_path = init_path + ".tmp"
    _protect_cache_path(init_path)
    try:
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", source,
                "-map", "0:v:0", "-map", "0:a?",
                "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-preset", "veryfast", "-crf", "23",
                "-c:a", "aac", "-ac", "2", "-b:a", "128k",
                "-t", "0",
                "-f", "mp4",
                "-movflags", "frag_keyframe+empty_moov+default_base_moof",
                tmp_path,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=60,
            check=True,
        )
        if os.path.isfile(tmp_path):
            os.replace(tmp_path, init_path)
        return init_path
    except (OSError, subprocess.SubprocessError) as exc:
        logging.getLogger(__name__).warning(f"HLS init generation failed for {source}: {exc}")
        return None
    finally:
        _unprotect_cache_path(init_path)


def _transcode_hls_segment(source: str, index: int, cache: CacheManager) -> str | None:
    """Transcode a single 4-second HLS segment on demand.

    To keep audio/video in sync when the player seeks to an arbitrary segment,
    we decode from the previous keyframe (fast seek) and then trim forward to
    the exact segment start (accurate seek). The output timestamps are reset
    to zero so the segment lines up with the #EXTINF declarations.
    """
    hls, _, _ = _hls_paths(source, cache)
    os.makedirs(hls, exist_ok=True)
    seg_path = _hls_segment_path(source, index, cache)
    if os.path.isfile(seg_path) and os.path.getsize(seg_path) > 0:
        return seg_path

    # Serialize concurrent requests for the same segment so only one ffmpeg
    # process runs and the rest wait on the cached result.
    inflight_key = f"{source}:{index}"
    with _SEGMENT_INFLIGHT_LOCK:
        lock = _SEGMENT_INFLIGHT_LOCKS.get(inflight_key)
        if lock is None:
            lock = threading.Lock()
            _SEGMENT_INFLIGHT_LOCKS[inflight_key] = lock
    with lock:
        if os.path.isfile(seg_path) and os.path.getsize(seg_path) > 0:
            return seg_path

        meta = _probe_video(source)
        duration = meta.get("duration")
        start, end = _segment_time_range(index, duration)
        if duration is not None and start >= duration:
            return None

        # Fast seek to the keyframe before the segment start, then decode
        # forward the remaining fraction so the output begins exactly at
        # ``start``. This keeps segment boundaries frame-perfect.
        prev_kf = _previous_keyframe(source, start)
        seek_before = max(0.0, prev_kf)
        seek_after = start - seek_before
        segment_duration = end - start

        tmp_path = seg_path + ".tmp"
        _protect_cache_path(seg_path)
        try:
            cmd = [
                "ffmpeg", "-y",
                "-ss", str(seek_before),
                "-i", source,
            ]
            if seek_after > 0.001:
                cmd.extend(["-ss", str(seek_after)])
            cmd.extend([
                "-t", str(segment_duration),
                "-map", "0:v:0", "-map", "0:a?",
                "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-preset", "veryfast", "-crf", "23",
                "-c:a", "aac", "-ac", "2", "-b:a", "128k",
                "-avoid_negative_ts", "make_zero",
                "-fflags", "+genpts",
                "-f", "mp4",
                "-movflags", "frag_keyframe+empty_moov+default_base_moof",
                tmp_path,
            ])
            subprocess.run(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                timeout=180,
                check=True,
            )
            if os.path.isfile(tmp_path):
                os.replace(tmp_path, seg_path)
            return seg_path
        except (OSError, subprocess.SubprocessError) as exc:
            logging.getLogger(__name__).warning(f"HLS segment {index} failed for {source}: {exc}")
            return None
        finally:
            _unprotect_cache_path(seg_path)


def _generate_hls_playlist(source: str, file_path: str, cache: CacheManager) -> str | None:
    """Generate a VOD playlist for the source."""
    meta = _probe_video(source)
    duration = meta.get("duration")
    count = _segment_count(duration)
    if count is None:
        return None
    file_q = urllib.parse.quote(file_path, safe="")
    lines = [
        "#EXTM3U",
        "#EXT-X-VERSION:6",
        f"#EXT-X-TARGETDURATION:{_HLS_SEGMENT_TIME}",
        '#EXT-X-MAP:URI="init.mp4"',
        "#EXT-X-PLAYLIST-TYPE:VOD",
    ]
    for i in range(count):
        start, end = _segment_time_range(i, duration)
        lines.append(f"#EXTINF:{end - start:.3f},")
        lines.append(_HLS_SEGMENT_PATTERN % i)
    lines.append("#EXT-X-ENDLIST")
    return "\n".join(lines) + "\n"


def _hls_progress(playlist_path: str) -> dict:
    """Return how much of the source has been transcoded so far.

    With on-demand segments this is just the sum of already-cached segment
    sizes; the playlist itself is always complete.
    """
    info = {"duration": 0.0, "bytes": 0}
    hls = os.path.dirname(playlist_path)
    if not os.path.isdir(hls):
        return info
    for name in os.listdir(hls):
        if name.endswith(".m4s") and name.startswith("seg-"):
            try:
                info["bytes"] += os.path.getsize(os.path.join(hls, name))
                info["duration"] += _HLS_SEGMENT_TIME
            except OSError:
                continue
    return info


def _transcode_status(source: str, cache: CacheManager, force: bool = False) -> dict:
    """Ensure the HLS init segment exists so the player can start immediately.

    The actual video segments are generated on demand by the /hls endpoint.
    """
    _, hls, playlist = _hls_paths(source, cache)
    if force and os.path.isdir(hls):
        try:
            shutil.rmtree(hls)
        except OSError:
            pass
    os.makedirs(hls, exist_ok=True)
    if not _ffmpeg_available:
        return {"status": "unavailable", "error": "ffmpeg is not installed"}
    init = _generate_hls_init(source, cache)
    if init is None:
        return {"status": "error", "error": "Failed to generate HLS init segment"}
    return {"status": "ready", "path": playlist}


def _human_size(num: float) -> str:
    n = float(num)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024.0 or unit == "TB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} {unit}"
        n /= 1024.0
    return f"{n:.1f} TB"


def _read_text(path: str) -> str | None:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read().strip()
    except (OSError, UnicodeDecodeError):
        return None


def _file_safe_join(base: str, *parts: str) -> str | None:
    """Join paths under base, rejecting escape attempts. Returns None on failure."""
    base_abs = os.path.abspath(base)
    candidate = os.path.abspath(os.path.join(base_abs, *parts))
    if os.path.commonpath([base_abs, candidate]) != base_abs:
        return None
    return candidate


# ------------------------------------------------------------------ #
# MKV → MP4 conversion (persistent, server-side)
# ------------------------------------------------------------------ #
#
# Unlike the transient HLS / remux cache, conversion writes a sibling
# ``<basename>.mp4`` next to the source so the scanner picks it up on the
# next refresh and the player serves the file directly with zero CPU. We
# pick the fastest viable path per source:
#
#   1. Stream copy  (``-c:v copy -c:a copy``) — near-instant for sources
#      whose video + audio codecs are already browser-decodable.
#   2. Hardware H.264 transcode (NVENC / VA-API / QSV / VideoToolbox) when
#      stream copy is not viable. Default CRF/preset picks favour speed
#      over size.
#   3. libx264 software fallback with ``-preset veryfast``.
#
# Jobs run on a single-worker executor; one job per source at a time. The
# output is left on disk until the user (or a future cleanup pass) deletes
# it. The scanner already dedupes ``Movie.mkv`` against ``Movie.mp4`` so a
# converted file automatically wins on the next scan.


_CONVERT_OUTPUT_SUFFIX = ".mp4"


def _convert_output_path(source: str) -> str:
    """Sibling ``.mp4`` path for a source video file."""
    base, _ = os.path.splitext(source)
    return base + _CONVERT_OUTPUT_SUFFIX


def _convert_can_stream_copy(meta: dict) -> tuple[bool, str]:
    """Decide whether a source can be remuxed with ``-c copy``.

    Returns ``(ok, reason)`` — ``reason`` is a short human label that the
    UI can show in the conversion status badge.
    """
    video_codec = (meta.get("videoCodec") or "").lower()
    pix_fmt = meta.get("pixelFormat") or ""
    audio_codec = (meta.get("audioCodec") or "").lower()
    if not video_codec:
        return False, "video codec unknown"
    if video_codec not in _BROWSER_VIDEO_CODECS and video_codec != "hevc":
        return False, f"{video_codec} not stream-copyable"
    # 10-bit HEVC / H.264 cannot be remuxed into a portable MP4.
    if pix_fmt.endswith("10le"):
        return False, "10-bit pixel format"
    if audio_codec and audio_codec not in _BROWSER_AUDIO_CODECS:
        return False, f"audio {audio_codec} not stream-copyable"
    return True, "stream copy"


def _build_convert_cmd(source: str, output: str, stream_copy: bool, hw: str | None) -> list[str]:
    """Compose the ffmpeg argv for the chosen conversion path.

    Every command ends with ``-progress pipe:2`` so the progress drain
    thread can stream ``out_time_ms=`` / ``speed=`` / ``total_size=`` /
    ``progress=continue|end`` updates while ffmpeg runs.
    """
    progress_flag = ["-progress", "pipe:2", "-nostats"]
    if stream_copy:
        return [
            "ffmpeg", "-y", "-fflags", "+genpts", "-i", source,
            "-map", "0:v:0", "-map", "0:a?",
            "-c:v", "copy", "-c:a", "copy",
            "-movflags", "+faststart",
            "-f", "mp4", output,
            *progress_flag,
        ]
    common_tail = ["-movflags", "+faststart", "-f", "mp4", output, *progress_flag]
    if hw == "h264_nvenc":
        return [
            "ffmpeg", "-y", "-hwaccel", "auto", "-i", source,
            "-map", "0:v:0", "-map", "0:a?",
            "-c:v", "h264_nvenc", "-preset", "medium", "-rc", "vbr",
            "-cq", "24", "-b:v", "0",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-ac", "2", "-b:a", "128k",
            *common_tail,
        ]
    if hw == "h264_vaapi":
        return [
            "ffmpeg", "-y", "-hwaccel", "vaapi",
            "-hwaccel_device", "/dev/dri/renderD128",
            "-i", source,
            "-map", "0:v:0", "-map", "0:a?",
            "-vf", "format=nv12,hwupload",
            "-c:v", "h264_vaapi", "-qp", "24",
            "-c:a", "aac", "-ac", "2", "-b:a", "128k",
            *common_tail,
        ]
    if hw == "h264_qsv":
        return [
            "ffmpeg", "-y", "-hwaccel", "qsv", "-i", source,
            "-map", "0:v:0", "-map", "0:a?",
            "-c:v", "h264_qsv", "-preset", "medium",
            "-global_quality", "24",
            "-c:a", "aac", "-ac", "2", "-b:a", "128k",
            *common_tail,
        ]
    if hw == "h264_videotoolbox":
        return [
            "ffmpeg", "-y", "-i", source,
            "-map", "0:v:0", "-map", "0:a?",
            "-c:v", "h264_videotoolbox", "-q:v", "60",
            "-c:a", "aac", "-ac", "2", "-b:a", "128k",
            *common_tail,
        ]
    # Software fallback. ``preset medium`` + ``crf 24`` is the libx264
    # sweet spot — visually transparent for 1080p sources while still
    # being 2-3x smaller than ``preset veryfast`` at the same CRF.
    # ``-threads 0`` lets ffmpeg pick all cores.
    return [
        "ffmpeg", "-y", "-i", source,
        "-map", "0:v:0", "-map", "0:a?",
        "-c:v", "libx264", "-preset", "medium", "-crf", "24",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-ac", "2", "-b:a", "128k",
        "-threads", "0",
        *common_tail,
    ]


_FFMPEG_OUT_TIME_RE = re.compile(r"^(\d+):(\d{1,2}):(\d{1,2})(?:\.(\d{1,9}))?$")


def _parse_ffmpeg_out_time(value: str) -> float | None:
    """Parse ``HH:MM:SS[.fraction]`` and return microseconds.

    ffmpeg prints ``out_time`` as ``HH:MM:SS.microseconds`` which is
    unambiguous regardless of the buggy ``out_time_us`` / ``out_time_ms``
    units that change between releases.
    """
    m = _FFMPEG_OUT_TIME_RE.match(value.strip())
    if not m:
        return None
    hh, mm, ss, frac = m.groups()
    try:
        base = int(hh) * 3600 + int(mm) * 60 + int(ss)
    except ValueError:
        return None
    if frac:
        # Pad/truncate the fractional part to microseconds.
        frac = (frac + "000000")[:6]
        try:
            micros = int(frac)
        except ValueError:
            micros = 0
    else:
        micros = 0
    return float(base) * 1_000_000.0 + float(micros)


def _parse_ffmpeg_progress_block(block: str) -> dict:
    """Parse one ffmpeg ``-progress`` block into a small dict.

    Returns any of: ``out_time_us`` (microseconds — derived from
    ``out_time``, the unambiguous HH:MM:SS field), ``total_size``
    (bytes), ``speed`` (float multiplier, e.g. ``1.5``), ``fps``,
    ``bitrate`` (kbps), ``progress`` (``"continue"`` / ``"end"``).
    Missing keys are omitted.
    """
    out: dict = {}
    for raw in block.splitlines():
        line = raw.strip()
        if not line or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if key == "out_time":
            us = _parse_ffmpeg_out_time(value)
            if us is not None:
                out["out_time_us"] = us
        elif key == "out_time_us":
            # ffmpeg 6.x reports this in milliseconds despite the name.
            # The ``out_time`` field above is authoritative when present.
            try:
                ms = float(value)
                out["out_time_us_ms_guess"] = ms
            except ValueError:
                pass
        elif key == "total_size":
            try:
                out["total_size"] = int(value)
            except ValueError:
                pass
        elif key == "speed":
            # e.g. "1.5x" or "N/A"
            try:
                out["speed"] = float(value.rstrip("x"))
            except ValueError:
                pass
        elif key == "fps":
            try:
                out["fps"] = float(value)
            except ValueError:
                pass
        elif key == "bitrate":
            # e.g. "1234.5kbits/s"
            num = value.replace("kbits/s", "").strip()
            try:
                out["bitrate_kbps"] = float(num)
            except ValueError:
                pass
        elif key == "progress":
            out["progress"] = value
    return out


def _run_convert(source: str, job_key: str, force: bool) -> None:
    """Run an MKV→MP4 conversion end-to-end and report status into ``_convert_jobs``.

    The output is written to a ``.tmp`` file first, then atomically renamed
    onto the final ``.mp4`` path. On any failure the partial output is
    cleaned up so a retry doesn't pile up disk garbage.

    Progress is published to ``_convert_jobs[job_key]["progress"]`` in
    0.5-second ticks so the UI can show a percent / ETA / speed.
    """
    output = _convert_output_path(source)
    tmp_output = output + ".tmp"
    _probe_tools()

    if force and os.path.isfile(output):
        try:
            os.remove(output)
        except OSError:
            pass

    if not _ffmpeg_available:
        with _convert_lock:
            _convert_jobs[job_key] = {"status": "unavailable", "error": "ffmpeg is not installed"}
        return

    meta = _probe_video(source)
    duration_us = (meta.get("duration") or 0) * 1_000_000 if meta.get("duration") else None
    stream_copy, mode_reason = _convert_can_stream_copy(meta)
    hw = None if stream_copy else _detect_hw_encoder()
    mode = (
        "copy"
        if stream_copy
        else (f"hw:{hw}" if hw else "sw:libx264")
    )

    cmd = _build_convert_cmd(source, tmp_output, stream_copy, hw)
    with _convert_lock:
        _convert_jobs[job_key] = {
            "status": "running",
            "mode": mode,
            "modeReason": mode_reason,
            "output": output,
            "duration": meta.get("duration"),
            "startedAt": int(time.time()),
            "progress": {
                "percent": 0.0,
                "outTime": 0.0,
                "speed": None,
                "fps": None,
                "bitrate": None,
                "updatedAt": int(time.time()),
            },
        }

    # Shared progress state written by the drain thread and read by the
    # status endpoint. Snapshot dicts are kept small so lock contention
    # is negligible at 2 Hz polling.
    progress_state = {
        "out_time_us": 0.0,
        "total_size": 0,
        "speed": None,
        "fps": None,
        "bitrate_kbps": None,
    }
    progress_lock = threading.Lock()
    last_publish = [0.0]

    def _publish_progress(force_publish: bool = False) -> None:
        now = time.time()
        if not force_publish and now - last_publish[0] < 0.5:
            return
        last_publish[0] = now
        with progress_lock:
            snapshot = {
                "out_time_us": progress_state["out_time_us"],
                "total_size": progress_state["total_size"],
                "speed": progress_state["speed"],
                "fps": progress_state["fps"],
                "bitrate_kbps": progress_state["bitrate_kbps"],
            }
        if duration_us and duration_us > 0:
            percent = max(0.0, min(1.0, snapshot["out_time_us"] / duration_us))
        else:
            percent = 0.0
        eta_seconds: float | None = None
        if (
            duration_us
            and snapshot["out_time_us"] > 0
            and snapshot["speed"]
            and snapshot["speed"] > 0.01
        ):
            remaining_us = max(0.0, duration_us - snapshot["out_time_us"])
            eta_seconds = remaining_us / 1_000_000.0 / snapshot["speed"]
        with _convert_lock:
            job = _convert_jobs.get(job_key)
            if job and job.get("status") == "running":
                job["progress"] = {
                    "percent": percent,
                    "outTime": snapshot["out_time_us"] / 1_000_000.0,
                    "totalSize": snapshot["total_size"],
                    "speed": snapshot["speed"],
                    "fps": snapshot["fps"],
                    "bitrateKbps": snapshot["bitrate_kbps"],
                    "etaSeconds": eta_seconds,
                    "updatedAt": int(now),
                }

    try:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

        def _drain_stderr() -> None:
            if process.stderr is None:
                return
            buf: list[str] = []
            try:
                for line in process.stderr:
                    # ffmpeg ``-progress pipe:2`` emits one block per status
                    # tick terminated by a ``progress=continue|end`` line.
                    buf.append(line)
                    if line.startswith("progress="):
                        block = "".join(buf)
                        buf.clear()
                        parsed = _parse_ffmpeg_progress_block(block)
                        with progress_lock:
                            if "out_time_us" in parsed:
                                progress_state["out_time_us"] = parsed["out_time_us"]
                            if "total_size" in parsed:
                                progress_state["total_size"] = parsed["total_size"]
                            if "speed" in parsed:
                                progress_state["speed"] = parsed["speed"]
                            if "fps" in parsed:
                                progress_state["fps"] = parsed["fps"]
                            if "bitrate_kbps" in parsed:
                                progress_state["bitrate_kbps"] = parsed["bitrate_kbps"]
                        _publish_progress()
            except (OSError, ValueError):
                pass

        drain_thread = threading.Thread(target=_drain_stderr, daemon=True)
        drain_thread.start()

        try:
            rc = process.wait()
        finally:
            drain_thread.join(timeout=2)
            _publish_progress(force_publish=True)

        if rc != 0:
            raise RuntimeError(f"ffmpeg exited with code {rc}")

        if not os.path.isfile(tmp_output) or os.path.getsize(tmp_output) == 0:
            raise RuntimeError("ffmpeg produced an empty output file")

        try:
            os.replace(tmp_output, output)
        except OSError as exc:
            raise RuntimeError(f"failed to publish output: {exc}")

        try:
            size = os.path.getsize(output)
        except OSError:
            size = 0
        with _convert_lock:
            _convert_jobs[job_key] = {
                "status": "ready",
                "mode": mode,
                "output": output,
                "size": size,
                "sizeHuman": _human_size(size),
                "duration": meta.get("duration"),
                "finishedAt": int(time.time()),
                "progress": {
                    "percent": 1.0,
                    "outTime": (meta.get("duration") or 0),
                    "totalSize": size,
                    "speed": None,
                    "fps": None,
                    "bitrateKbps": None,
                    "etaSeconds": 0,
                    "updatedAt": int(time.time()),
                },
            }
    except (OSError, subprocess.SubprocessError, RuntimeError) as exc:
        # Clean up the partial output so a retry can start fresh.
        try:
            if os.path.isfile(tmp_output):
                os.remove(tmp_output)
        except OSError:
            pass
        message = (str(exc) or "").strip().splitlines()
        with _convert_lock:
            _convert_jobs[job_key] = {
                "status": "error",
                "error": (message[-1] if message else str(exc))[:300],
                "mode": mode,
                "duration": meta.get("duration"),
                "progress": {
                    "percent": 0.0,
                    "outTime": 0.0,
                    "updatedAt": int(time.time()),
                },
            }


def _convert_status(source: str, force: bool = False) -> dict:
    """Inspect / kick off a conversion. Idempotent like the remux helper.

    - If the sibling ``.mp4`` already exists and ``force`` is False, return
      ``ready`` immediately (including the latest cached progress so the UI
      can keep showing a 100 % bar until the next library refresh).
    - If a job is already running for this source, return its current state
      so the UI can show progress without spawning a duplicate.
    - Otherwise queue a new job and return ``queued`` so the caller can poll.
    """
    _probe_tools()
    key = source
    output = _convert_output_path(source)
    source_size = 0
    try:
        source_size = os.path.getsize(source)
    except OSError:
        pass

    if not force and os.path.isfile(output) and os.path.getsize(output) > 0:
        # Source is newer than the converted file → invalidate.
        try:
            src_mtime = os.path.getmtime(source)
            out_mtime = os.path.getmtime(output)
            if out_mtime >= src_mtime:
                size = os.path.getsize(output)
                ready = {
                    "status": "ready",
                    "output": output,
                    "size": size,
                    "sizeHuman": _human_size(size),
                    "progress": {
                        "percent": 1.0,
                        "outTime": None,
                        "totalSize": size,
                        "speed": None,
                        "fps": None,
                        "bitrateKbps": None,
                        "etaSeconds": 0,
                        "updatedAt": int(time.time()),
                    },
                }
                # Carry forward the last running progress (mode, fps, etc.).
                with _convert_lock:
                    cached = _convert_jobs.get(key) or {}
                for keep in ("mode", "modeReason", "duration"):
                    if keep in cached and keep not in ready:
                        ready[keep] = cached[keep]
                return ready
        except OSError:
            pass

    if force and os.path.isfile(output):
        try:
            os.remove(output)
        except OSError:
            pass

    with _convert_lock:
        existing = _convert_jobs.get(key)
    if existing and existing.get("status") in ("queued", "running"):
        return existing

    if not _ffmpeg_available:
        return {"status": "unavailable", "error": "ffmpeg is not installed"}

    with _convert_lock:
        _convert_jobs[key] = {
            "status": "queued",
            "sourceSize": source_size,
            "progress": {
                "percent": 0.0,
                "outTime": 0.0,
                "speed": None,
                "fps": None,
                "bitrateKbps": None,
                "etaSeconds": None,
                "updatedAt": int(time.time()),
            },
        }
    _convert_executor.submit(_run_convert, source, key, False)
    return _convert_jobs[key]


def _convert_cancel(source: str) -> dict:
    """Best-effort cancel. Removes the job entry and any partial output.

    The executor's running ffmpeg process is NOT killed (we don't track the
    Popen in the job dict). Its output goes to ``.tmp`` and gets cleaned
    up at the end of the run, so leaving it alone is safe.
    """
    output = _convert_output_path(source)
    tmp_output = output + ".tmp"
    with _convert_lock:
        job = _convert_jobs.pop(source, None)
        # Replace with a cancelled marker so a subsequent poll sees a
        # terminal state.
        _convert_jobs[source] = {"status": "cancelled", "output": output}
    try:
        if os.path.isfile(tmp_output):
            os.remove(tmp_output)
    except OSError:
        pass
    try:
        if os.path.isfile(output):
            os.remove(output)
    except OSError:
        pass
    return {"status": "cancelled", "previous": job}


def _convert_delete_output(source: str) -> dict:
    """Remove the converted sibling without touching the source. No-op if absent."""
    output = _convert_output_path(source)
    removed = False
    try:
        if os.path.isfile(output):
            os.remove(output)
            removed = True
    except OSError:
        pass
    return {"status": "ok", "removed": removed, "output": output}


# ------------------------------------------------------------------ #
# State persistence (.cinema_state.json)
# ------------------------------------------------------------------ #


class StateStore:
    """JSON-backed store for per-media user metadata."""

    def __init__(self, path: str):
        self.path = path
        self._cache: dict | None = None

    def _load(self) -> dict:
        if self._cache is not None:
            return self._cache
        if not os.path.exists(self.path):
            self._cache = {}
            return self._cache
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    self._cache = data
                    return data
        except (OSError, json.JSONDecodeError):
            pass
        self._cache = {}
        return self._cache

    def _save(self) -> None:
        data = self._cache if self._cache is not None else {}
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        # The save is two-step (write .tmp, then os.replace) and the
        # tmp filename is shared across every StateStore instance, so
        # without a lock two Flask threads can race: thread B's
        # `open(tmp, "w")` truncates the tmp that thread A is still
        # writing, and `os.replace` ends up raising FileNotFoundError
        # when the tmp has already been renamed away by the other
        # thread. The lock serialises the (write, replace) pair.
        with _STATE_SAVE_LOCK:
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            os.replace(tmp, self.path)

    def get(self, media_id: str) -> dict:
        data = self._load()
        return data.get(media_id, {})

    def all(self) -> dict:
        return dict(self._load())

    def upsert(self, media_id: str, patch: dict) -> dict:
        data = self._load()
        existing = data.get(media_id, {})
        merged = {**existing, **patch}
        merged["updatedAt"] = int(time.time())
        merged.setdefault("createdAt", merged["updatedAt"])
        data[media_id] = merged
        self._save()
        return merged

    def delete(self, media_id: str) -> bool:
        data = self._load()
        if media_id in data:
            del data[media_id]
            self._save()
            return True
        return False


# ------------------------------------------------------------------ #
# Library scanning
# ------------------------------------------------------------------ #


def _is_scannable_video(filename: str) -> bool:
    """True if the file looks like a real video the scanner should index."""
    if not filename or filename.startswith(".") or filename.lower() in _IGNORED_BASENAMES:
        return False
    # Ignore stray ffmpeg partial files. (No MP4 sibling artifact any more —
    # playback uses HLS only.)
    if filename.lower().endswith(".tmp.mp4"):
        return False
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return ext in _VIDEO_EXTS


def _is_scannable_hls_dir(folder: str) -> bool:
    name = os.path.basename(folder.rstrip("/\\"))
    return name.endswith(_HLS_DIR_EXT)


def _list_subdirs(folder: str) -> list[str]:
    if not os.path.isdir(folder):
        return []
    return sorted(
        e for e in os.listdir(folder)
        if not e.startswith(".")
        and e.lower() not in _IGNORED_BASENAMES
        and not _is_scannable_hls_dir(e)
        and os.path.isdir(os.path.join(folder, e))
    )


def _list_files(folder: str) -> list[str]:
    if not os.path.isdir(folder):
        return []
    return sorted(
        e for e in os.listdir(folder)
        if _is_scannable_video(e)
        and os.path.isfile(os.path.join(folder, e))
    )


# When ``movie.mkv`` and ``movie.mp4`` both exist, the scanner keeps only the
# MP4. The priority list picks the most browser-friendly container first so a
# converted sibling automatically wins over the original MKV.
_VIDEO_EXT_PRIORITY = {"mp4": 0, "m4v": 1, "mov": 2, "webm": 3, "mkv": 4, "avi": 5}


def _dedupe_video_files(files: list[str]) -> list[str]:
    """Pick the best file per case-insensitive stem.

    If ``movie.mkv`` and ``movie.mp4`` live in the same folder, only the MP4
    is kept. Subtitles, artwork, and metadata files are not affected.
    """
    by_stem: dict[str, str] = {}
    for f in files:
        stem, ext = os.path.splitext(f)
        ext = ext.lstrip(".").lower()
        key = stem.lower()
        if key not in by_stem:
            by_stem[key] = f
            continue
        cur_ext = os.path.splitext(by_stem[key])[1].lstrip(".").lower()
        if _VIDEO_EXT_PRIORITY.get(ext, 99) < _VIDEO_EXT_PRIORITY.get(cur_ext, 99):
            by_stem[key] = f
    return sorted(by_stem.values())


def _detect_poster(folder: str) -> str | None:
    """Look for poster/fanart/backdrop artwork."""
    candidates = [
        "poster.jpg", "poster.png", "poster.jpeg", "poster.webp",
        "folder.jpg", "folder.png", "folder.jpeg", "folder.webp",
        "cover.jpg", "cover.png", "cover.jpeg", "cover.webp",
    ]
    for name in candidates:
        full = os.path.join(folder, name)
        if os.path.isfile(full):
            return name
    # Fallback: first image-like file.
    for f in _list_files(folder):
        if f.lower().endswith(tuple("." + ext for ext in _IMAGE_EXTS)):
            return f
    return None


def _detect_backdrop(folder: str) -> str | None:
    candidates = [
        "backdrop.jpg", "backdrop.png", "backdrop.jpeg", "backdrop.webp",
        "fanart.jpg", "fanart.png", "fanart.jpeg", "fanart.webp",
        "banner.jpg", "banner.png", "banner.jpeg", "banner.webp",
    ]
    for name in candidates:
        full = os.path.join(folder, name)
        if os.path.isfile(full):
            return name
    return None


def _detect_file_art(parent_dir: str, file_basename: str) -> tuple[str | None, str | None]:
    """Find per-file art (poster / backdrop) for a loose video file.

    Looks in ``parent_dir`` for ``<slug>.poster.<ext>`` and the backdrop
    equivalent. The slug is derived from the video filename stem, matching
    the naming used by ``/api/cinema/art/<id>`` uploads so user-uploaded
    art shows up after the next scan.
    """
    stem = os.path.splitext(file_basename)[0]
    slug = _slugify(stem) or "item"
    poster = None
    backdrop = None
    for ext in _IMAGE_EXTS:
        cand = f"{slug}.poster.{ext}"
        if os.path.isfile(os.path.join(parent_dir, cand)):
            poster = cand
            break
    for ext in _IMAGE_EXTS:
        cand = f"{slug}.backdrop.{ext}"
        if os.path.isfile(os.path.join(parent_dir, cand)):
            backdrop = cand
            break
    return poster, backdrop


# Screenshot naming conventions.
#   Folder-style media:     screenshot.jpg, screenshot-1.jpg, screenshot-2.jpg, ...
#   Loose file (file-slug): <slug>.screenshot.jpg, <slug>.screenshot-1.jpg, ...
# ``screenshot`` (no suffix) sorts before ``screenshot-1`` alphabetically,
# so we sort by the integer index extracted from the filename.
#
# The ``<slug>`` segment (optional, before ``.screenshot``) lets loose files
# carry their own screenshot set so two movies in the same folder don't
# collide.

_SCREENSHOT_RE = re.compile(
    r"^(?:(?P<slug>[a-z0-9-]+)\.)?screenshot(?:-(?P<num>\d+))?\.(?P<ext>jpg|jpeg|png|webp)$",
    re.IGNORECASE,
)


def _detect_screenshots(folder: str, file_basename: str | None = None) -> list[dict]:
    """Return screenshot entries for ``folder``.

    When ``file_basename`` is set, only ``<slug>.screenshot[-N].<ext>``
    files belonging to that loose file are returned. Otherwise, the
    folder-level ``screenshot[-N].<ext>`` files are returned.

    Each entry: ``{"name": ..., "index": int, "size": int_bytes}``,
    sorted by index. ``index=0`` is the un-numbered ``screenshot.<ext>``.
    """
    out: list[tuple[int, str, int]] = []
    try:
        entries = os.listdir(folder)
    except OSError:
        return []
    expected_slug = None
    if file_basename:
        expected_slug = _slugify(os.path.splitext(file_basename)[0]) or "item"
    for name in entries:
        m = _SCREENSHOT_RE.match(name)
        if not m:
            continue
        slug_part = m.group("slug")
        if file_basename:
            # Per-file mode: must have the matching slug prefix.
            if slug_part != expected_slug:
                continue
        else:
            # Folder-level mode: reject slugged names — they belong to a
            # specific loose file, not the folder as a whole.
            if slug_part is not None:
                continue
        idx = int(m.group("num")) if m.group("num") else 0
        full = os.path.join(folder, name)
        if not os.path.isfile(full):
            continue
        try:
            size = os.path.getsize(full)
        except OSError:
            size = 0
        out.append((idx, name, size))
    out.sort(key=lambda x: x[0])
    return [{"name": name, "index": idx, "size": size} for idx, name, size in out]


def _screenshot_url(media_id: str, name: str) -> str:
    """Build the cache-busted URL the frontend uses to display a screenshot."""
    return (
        f"/api/cinema/screenshots/{urllib.parse.quote(media_id, safe='')}"
        f"?name={urllib.parse.quote(name, safe='')}"
    )


def _attach_screenshot_urls(screenshots: list[dict], media_id: str) -> list[dict]:
    """Return ``screenshots`` with a ``url`` field attached to each entry.

    ``_detect_screenshots`` only knows about the on-disk files; the media id
    is needed to build the URL, so we add it here at the library-scan
    boundary instead of threading it through the detector.
    """
    return [
        {**shot, "url": _screenshot_url(media_id, shot["name"])}
        for shot in screenshots
    ]


def _parse_subtitles(folder: str, video_basename: str) -> list[dict]:
    """Find subtitle files matching a video, parse language code from filename."""
    tracks: list[dict] = []
    seen: set[str] = set()
    for f in _list_files(folder):
        if not f.lower().endswith(_SUBTITLE_EXTS):
            continue
        stem, ext = os.path.splitext(f)
        ext = ext.lstrip(".").lower()
        # Try matching patterns:
        #   <video>.en.srt   <video>.en.forced.srt   <video>.srt   <video>.English.srt
        suffix = stem[len(video_basename):].lstrip(".") if stem.lower().startswith(video_basename.lower()) else stem
        lang = "en"
        label = "English"
        if suffix:
            # Take the first 2-3 letter token as language code.
            tokens = re.split(r"[\. _\-]+", suffix.strip())
            token = tokens[0].lower() if tokens else ""
            if token in ("forced", "sdh", "cc", "hi"):
                label = token.upper()
                token = tokens[1].lower() if len(tokens) > 1 else ""
            if token:
                lang = token[:3]
                label = {
                    "en": "English",
                    "eng": "English",
                    "fa": "Persian",
                    "per": "Persian",
                    "es": "Spanish",
                    "spa": "Spanish",
                    "fr": "French",
                    "fre": "French",
                    "de": "German",
                    "ger": "German",
                    "it": "Italian",
                    "ja": "Japanese",
                    "jpn": "Japanese",
                    "ko": "Korean",
                    "kor": "Korean",
                    "zh": "Chinese",
                    "chi": "Chinese",
                    "ar": "Arabic",
                    "ara": "Arabic",
                    "ru": "Russian",
                    "rus": "Russian",
                    "pt": "Portuguese",
                    "tr": "Turkish",
                    "tur": "Turkish",
                }.get(lang, lang.upper())
        key = (lang, label)
        if key in seen:
            continue
        seen.add(key)
        tracks.append({
            "lang": lang,
            "label": label,
            "filename": f,
            "format": ext,
        })
    # Stable order: English first, then alphabetical.
    tracks.sort(key=lambda t: (0 if t["lang"].startswith("en") else 1, t["label"]))
    return tracks


def _scan_movie(item_dir: str, category: str, rel_path: str) -> dict | None:
    files = _dedupe_video_files(_list_files(item_dir))
    video_files: list[dict] = []
    for f in files:
        ext = f.rsplit(".", 1)[-1].lower() if "." in f else ""
        if ext not in _VIDEO_EXTS:
            continue
        full = os.path.join(item_dir, f)
        try:
            size = os.path.getsize(full)
        except OSError:
            size = 0
        base = os.path.splitext(f)[0]
        meta = _probe_video(full)
        video_files.append({
            "id": _slugify(f"{rel_path}-{base}"),
            "filename": f,
            "path": f"{rel_path}/{f}".replace("\\", "/"),
            "size": _human_size(size),
            "sizeBytes": size,
            "ext": ext,
            "subtitles": _parse_subtitles(item_dir, base),
            "videoCodec": meta.get("videoCodec"),
            "pixelFormat": meta.get("pixelFormat"),
            "audioCodec": meta.get("audioCodec"),
            "containerFormat": meta.get("containerFormat"),
            "duration": meta.get("duration"),
            "browserFriendly": meta.get("browserFriendly", ext in {"mp4", "m4v"}),
            "playbackStrategy": meta.get("playbackStrategy", "direct" if ext in {"mp4", "m4v"} else "transcode"),
        })
    if not video_files:
        return None

    folder_name = os.path.basename(item_dir.rstrip("/\\")) or "Untitled"
    parsed = _parse_title(folder_name)
    poster = _detect_poster(item_dir)
    backdrop = _detect_backdrop(item_dir)
    synopsis = _read_text(os.path.join(item_dir, "synopsis.txt")) or \
        _read_text(os.path.join(item_dir, "overview.txt")) or \
        _read_text(os.path.join(item_dir, "description.txt"))
    genres_raw = _read_text(os.path.join(item_dir, "genres.txt"))
    genres = [g.strip() for g in (genres_raw or "").split(",") if g.strip()] if genres_raw else []
    runtime_raw = _read_text(os.path.join(item_dir, "runtime.txt"))
    try:
        runtime = int(runtime_raw) if runtime_raw else None
    except ValueError:
        runtime = None
    rating_raw = _read_text(os.path.join(item_dir, "rating.txt"))
    try:
        rating = float(rating_raw) if rating_raw else None
    except ValueError:
        rating = None
    cast = []
    cast_raw = _read_text(os.path.join(item_dir, "cast.txt"))
    if cast_raw:
        cast = [c.strip() for c in re.split(r"[,;]\s*", cast_raw) if c.strip()]
    director = _read_text(os.path.join(item_dir, "director.txt"))
    trailer = _read_text(os.path.join(item_dir, "trailer.txt"))

    item_id = _slugify(rel_path)
    return {
        "id": item_id,
        "title": parsed["title"],
        "originalTitle": parsed["title"],
        "year": parsed["year"],
        "type": _category_type(category),
        "category": category,
        "path": rel_path,
        "poster": poster,
        "backdrop": backdrop,
        "synopsis": synopsis or "",
        "genres": genres,
        "rating": rating,
        "runtime": runtime,
        "cast": cast,
        "director": director,
        "trailer": trailer,
        "files": video_files,
        "seasons": None,
        "screenshots": _attach_screenshot_urls(_detect_screenshots(item_dir), item_id),
    }


def _scan_series(item_dir: str, category: str, rel_path: str) -> dict | None:
    """Scan a series folder with optional Season X subfolders."""
    folder_name = os.path.basename(item_dir.rstrip("/\\")) or "Untitled"
    parsed = _parse_title(folder_name)
    poster = _detect_poster(item_dir)
    backdrop = _detect_backdrop(item_dir)
    synopsis = _read_text(os.path.join(item_dir, "synopsis.txt")) or \
        _read_text(os.path.join(item_dir, "overview.txt")) or \
        _read_text(os.path.join(item_dir, "description.txt"))
    genres_raw = _read_text(os.path.join(item_dir, "genres.txt"))
    genres = [g.strip() for g in (genres_raw or "").split(",") if g.strip()] if genres_raw else []
    rating_raw = _read_text(os.path.join(item_dir, "rating.txt"))
    try:
        rating = float(rating_raw) if rating_raw else None
    except ValueError:
        rating = None
    cast_raw = _read_text(os.path.join(item_dir, "cast.txt"))
    cast = [c.strip() for c in re.split(r"[,;]\s*", cast_raw) if c.strip()] if cast_raw else []
    director = _read_text(os.path.join(item_dir, "creator.txt")) or \
        _read_text(os.path.join(item_dir, "director.txt"))
    trailer = _read_text(os.path.join(item_dir, "trailer.txt"))

    seasons: list[dict] = []
    loose_files: list[dict] = []

    # Look for "Season X" / "Specials" subfolders
    season_dirs = []
    loose_dir = []
    for entry in _list_subdirs(item_dir):
        if re.match(r"^(season|series|s)\s*\d+$", entry, re.IGNORECASE) or entry.lower() == "specials":
            season_dirs.append(entry)
        else:
            loose_dir.append(entry)

    season_dirs.sort(key=lambda s: (
        0 if s.lower() == "specials" else 1,
        int(re.search(r"\d+", s).group(0)) if re.search(r"\d+", s) else 0,
    ))

    for sdir in season_dirs:
        m = re.search(r"\d+", sdir)
        season_num = int(m.group(0)) if m else (len(seasons) + 1)
        if sdir.lower() == "specials":
            season_num = 0
        full = os.path.join(item_dir, sdir)
        rel = f"{rel_path}/{sdir}".replace("\\", "/")
        episodes: list[dict] = []
        for f in _dedupe_video_files(_list_files(full)):
                ext = f.rsplit(".", 1)[-1].lower() if "." in f else ""
                if ext not in _VIDEO_EXTS:
                    continue
                m_ep = re.search(r"(?:s\d{1,2}e(\d{1,3})|e(\d{1,3})|ep?(\d{1,3})|(\d{1,3}))", f.lower())
                ep_num = int(next((g for g in m_ep.groups() if g is not None), 0)) if m_ep else (len(episodes) + 1)
                ep_parsed = _parse_title(os.path.splitext(f)[0])
                ep_full = os.path.join(full, f)
                try:
                    size = os.path.getsize(ep_full)
                except OSError:
                    size = 0
                meta = _probe_video(ep_full)
                episodes.append({
                    "id": _slugify(f"{rel}-{os.path.splitext(f)[0]}"),
                    "number": ep_num,
                    "title": ep_parsed["title"],
                    "filename": f,
                    "path": f"{rel}/{f}".replace("\\", "/"),
                    "size": _human_size(size),
                    "sizeBytes": size,
                    "ext": ext,
                    "subtitles": _parse_subtitles(full, os.path.splitext(f)[0]),
                    "videoCodec": meta.get("videoCodec"),
                    "pixelFormat": meta.get("pixelFormat"),
                    "audioCodec": meta.get("audioCodec"),
                    "containerFormat": meta.get("containerFormat"),
                    "duration": meta.get("duration"),
                    "browserFriendly": meta.get("browserFriendly", ext in {"mp4", "m4v"}),
                    "playbackStrategy": meta.get("playbackStrategy", "direct" if ext in {"mp4", "m4v"} else "transcode"),
                })
        if episodes:
            episodes.sort(key=lambda e: e["number"])
            seasons.append({
                "number": season_num,
                "title": sdir,
                "path": rel,
                "episodes": episodes,
            })

    # Files directly in the series folder become Season 1 if no season subfolders exist
    if not seasons:
        for f in _dedupe_video_files(_list_files(item_dir)):
            ext = f.rsplit(".", 1)[-1].lower() if "." in f else ""
            if ext not in _VIDEO_EXTS:
                continue
            try:
                size = os.path.getsize(os.path.join(item_dir, f))
            except OSError:
                size = 0
            base = os.path.splitext(f)[0]
            full = os.path.join(item_dir, f)
            meta = _probe_video(full)
            loose_files.append({
                "id": _slugify(f"{rel_path}-{base}"),
                "number": len(loose_files) + 1,
                "title": _parse_title(base)["title"],
                "filename": f,
                "path": f"{rel_path}/{f}".replace("\\", "/"),
                "size": _human_size(size),
                "sizeBytes": size,
                "ext": ext,
                "subtitles": _parse_subtitles(item_dir, base),
                "videoCodec": meta.get("videoCodec"),
                "pixelFormat": meta.get("pixelFormat"),
                "audioCodec": meta.get("audioCodec"),
                "containerFormat": meta.get("containerFormat"),
                "duration": meta.get("duration"),
                "browserFriendly": meta.get("browserFriendly", ext in {"mp4", "m4v"}),
                "playbackStrategy": meta.get("playbackStrategy", "direct" if ext in {"mp4", "m4v"} else "transcode"),
            })
        if loose_files:
            loose_files.sort(key=lambda e: e["number"])
            seasons.append({
                "number": 1,
                "title": "Season 1",
                "path": rel_path,
                "episodes": loose_files,
            })

    if not seasons:
        return None

    item_id = _slugify(rel_path)
    return {
        "id": item_id,
        "title": parsed["title"],
        "originalTitle": parsed["title"],
        "year": parsed["year"],
        "type": _category_type(category) if category else "series",
        "category": category,
        "path": rel_path,
        "poster": poster,
        "backdrop": backdrop,
        "synopsis": synopsis or "",
        "genres": genres,
        "rating": rating,
        "runtime": None,
        "cast": cast,
        "director": director,
        "trailer": trailer,
        "files": [],
        "seasons": seasons,
        "screenshots": _attach_screenshot_urls(_detect_screenshots(item_dir), item_id),
    }


def scan_library(upload_folder: str, roots: Iterable[str]) -> list[dict]:
    """Walk configured roots and return a normalized media library.

    Supported layouts:
      <root>/<Category>/<Item>/<files...>      (preferred, allows metadata)
      <root>/<Category>/<files...>              (loose files: each becomes its own item)
      <root>/<Category>/<Item>/Season X/...     (series)
      <root>/<files...>                         (root acts as a single category)
    """
    items: list[dict] = []

    def _scan_loose(category: str, cat_type: str, dir_abs: str, dir_rel: str) -> list[dict]:
        loose_videos = _dedupe_video_files([
            f for f in _list_files(dir_abs)
            if (f.rsplit(".", 1)[-1].lower() if "." in f else "") in _VIDEO_EXTS
        ])
        # Default art for the folder — used as a fallback when a specific
        # loose file doesn't have its own per-file art.
        folder_poster = _detect_poster(dir_abs)
        folder_backdrop = _detect_backdrop(dir_abs)
        synopsis = _read_text(os.path.join(dir_abs, "synopsis.txt")) or \
            _read_text(os.path.join(dir_abs, "overview.txt"))
        out: list[dict] = []
        for f in loose_videos:
            ext = f.rsplit(".", 1)[-1].lower() if "." in f else ""
            full = os.path.join(dir_abs, f)
            try:
                size = os.path.getsize(full)
            except OSError:
                size = 0
            base = os.path.splitext(f)[0]
            parsed = _parse_title(base)
            # ``item_rel`` (used for the stable media id) is the stem only —
            # converting ``Movie.mkv`` to ``Movie.mp4`` keeps the same id so
            # ratings, progress, and state survive. The actual playable
            # ``files[].path`` still carries the extension so the player,
            # stream and art endpoints can find the file on disk.
            item_rel = f"{dir_rel}/{base}".replace("\\", "/")
            file_rel = f"{item_rel}.{ext}".replace("\\", "/")
            item_id = _slugify(item_rel)
            meta = _probe_video(full)
            # Per-file art takes priority over folder art.
            file_poster, file_backdrop = _detect_file_art(dir_abs, f)
            out.append({
                "id": item_id,
                "title": parsed["title"],
                "originalTitle": parsed["title"],
                "year": parsed["year"],
                "type": cat_type,
                "category": category,
                "path": file_rel,
                "poster": file_poster or folder_poster,
                "backdrop": file_backdrop or folder_backdrop,
                "synopsis": synopsis or "",
                "genres": [],
                "rating": None,
                "runtime": None,
                "cast": [],
                "director": None,
                "trailer": None,
                "files": [{
                    "id": _slugify(f"{item_rel}-file"),
                    "filename": f,
                    "path": file_rel,
                    "size": _human_size(size),
                    "sizeBytes": size,
                    "ext": ext,
                    "subtitles": _parse_subtitles(dir_abs, base),
                    "videoCodec": meta.get("videoCodec"),
                    "pixelFormat": meta.get("pixelFormat"),
                    "audioCodec": meta.get("audioCodec"),
                    "containerFormat": meta.get("containerFormat"),
                    "duration": meta.get("duration"),
                    "browserFriendly": meta.get("browserFriendly", ext in {"mp4", "m4v"}),
                    "playbackStrategy": meta.get("playbackStrategy", "direct" if ext in {"mp4", "m4v"} else "transcode"),
                }],
                "seasons": None,
                "screenshots": _attach_screenshot_urls(
                    _detect_screenshots(dir_abs, file_basename=f), item_id
                ),
            })
        return out

    for root_rel in roots:
        root_abs = _file_safe_join(upload_folder, root_rel.replace("\\", "/"))
        if not root_abs or not os.path.isdir(root_abs):
            continue

        # If the root itself contains loose video files, treat it as a single category.
        root_loose = [
            f for f in _list_files(root_abs)
            if (f.rsplit(".", 1)[-1].lower() if "." in f else "") in _VIDEO_EXTS
        ]
        root_cat = os.path.basename(root_abs.rstrip("/\\")) or "Cinema"
        root_cat_type = _category_type(root_cat)

        for category in _list_subdirs(root_abs):
            category_abs = os.path.join(root_abs, category)
            category_rel = f"{root_rel}/{category}".replace("\\", "/")
            cat_type = _category_type(category)

            sub_items = _list_subdirs(category_abs)
            if sub_items:
                for item_dir_name in sub_items:
                    item_dir_abs = os.path.join(category_abs, item_dir_name)
                    item_dir_rel = f"{category_rel}/{item_dir_name}".replace("\\", "/")
                    if cat_type == "series":
                        item = _scan_series(item_dir_abs, category, item_dir_rel)
                    else:
                        item = _scan_movie(item_dir_abs, category, item_dir_rel)
                    if item:
                        items.append(item)
            else:
                items.extend(_scan_loose(category, cat_type, category_abs, category_rel))

        # Loose files directly under the root -> each is its own item.
        if root_loose:
            items.extend(_scan_loose(root_cat, root_cat_type, root_abs, root_rel))

    items.sort(key=lambda m: ((m.get("year") or 0) * -1, (m.get("title") or "").lower()))
    return items


def get_media_by_id(upload_folder: str, roots: Iterable[str], media_id: str) -> dict | None:
    library = scan_library(upload_folder, roots)
    for m in library:
        if m["id"] == media_id:
            return m
    return None


def resolve_video_path(upload_folder: str, roots: Iterable[str], media_id: str, file_path: str) -> str | None:
    """Return absolute path to a video file if it's actually inside the cinema library."""
    media = get_media_by_id(upload_folder, roots, media_id)
    if not media:
        return None
    allowed = []
    if media.get("files"):
        for f in media["files"]:
            allowed.append(f["path"])
    if media.get("seasons"):
        for s in media["seasons"]:
            for ep in s["episodes"]:
                allowed.append(ep["path"])
    file_path = file_path.replace("\\", "/")
    if file_path not in allowed:
        return None
    full = _file_safe_join(upload_folder, file_path)
    if not full or not os.path.isfile(full):
        return None
    # Reject our own artifacts in case they ever sneak into the requested path.
    if full.lower().endswith((".tmp.mp4",)):
        return None
    # Must still be inside one of the configured roots.
    for root in roots:
        root_abs = os.path.abspath(os.path.join(upload_folder, root.replace("\\", "/")))
        if os.path.commonpath([root_abs, full]) == root_abs:
            return full
    return None


def resolve_subtitle_path(upload_folder: str, media_id: str, file_path: str, sub_filename: str) -> tuple[str | None, str | None]:
    """Return (absolute_path, format) for a subtitle file inside a media folder, or None."""
    media = get_media_by_id(upload_folder, _DEFAULT_ROOTS, media_id)
    if not media:
        return None, None
    media_dir = os.path.dirname(resolve_video_path(upload_folder, _DEFAULT_ROOTS, media_id, file_path) or "")
    # If we couldn't resolve via library paths, fall back to scanning by relative media path.
    if not media_dir or not os.path.isdir(media_dir):
        media_dir_abs = _file_safe_join(upload_folder, media["path"])
        if not media_dir_abs or not os.path.isdir(media_dir_abs):
            return None, None
        media_dir = media_dir_abs
    sub_full = os.path.join(media_dir, secure_filename(sub_filename))
    if not os.path.isfile(sub_full):
        return None, None
    if os.path.commonpath([os.path.abspath(media_dir), os.path.abspath(sub_full)]) != os.path.abspath(media_dir):
        return None, None
    fmt = sub_full.rsplit(".", 1)[-1].lower()
    return sub_full, fmt


# ------------------------------------------------------------------ #
# Subtitle conversion (SRT -> VTT)
# ------------------------------------------------------------------ #


_SRT_TIME_RE = re.compile(r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})")


def _srt_to_vtt(srt_text: str) -> str:
    srt_text = srt_text.replace("\r\n", "\n").replace("\r", "\n")
    out = ["WEBVTT\n\n"]
    blocks = re.split(r"\n\s*\n", srt_text.strip())
    for block in blocks:
        lines = [l for l in block.split("\n") if l.strip() != ""]
        if not lines:
            continue
        # Drop numeric cue index if present
        if lines and lines[0].strip().isdigit():
            lines = lines[1:]
        if not lines:
            continue
        timing_line = None
        for i, line in enumerate(lines):
            if "-->" in line:
                timing_line = i
                break
        if timing_line is None:
            continue
        timing = lines[timing_line].strip()
        # Normalize comma in timestamps to dot.
        timing = timing.replace(",", ".")
        out.append(timing + "\n")
        text_lines = lines[timing_line + 1:]
        out.extend(text_lines)
        out.append("\n")
    return "".join(out)


# ------------------------------------------------------------------ #
# Range streaming
# ------------------------------------------------------------------ #


def _range_stream_response(abs_path: str, mimetype: str | None):
    """Serve a file with HTTP Range support for video seeking."""
    if not os.path.isfile(abs_path):
        abort(404)
    file_size = os.path.getsize(abs_path)
    range_header = request.headers.get("Range", None)
    if not range_header:
        return send_file(abs_path, mimetype=mimetype, conditional=True)
    m = re.match(r"bytes=(\d*)-(\d*)$", range_header.strip())
    if not m:
        return send_file(abs_path, mimetype=mimetype, conditional=True)
    start_s, end_s = m.group(1), m.group(2)
    if start_s == "" and end_s == "":
        abort(416)
    if start_s == "":
        # suffix length: last N bytes
        length = int(end_s)
        if length <= 0:
            abort(416)
        start = max(file_size - length, 0)
        end = file_size - 1
    else:
        start = int(start_s)
        end = int(end_s) if end_s else file_size - 1
    if start >= file_size or end >= file_size or start > end:
        return Response(status=416, headers={"Content-Range": f"bytes */{file_size}"})
    length = end - start + 1

    def generate():
        with open(abs_path, "rb") as f:
            f.seek(start)
            remaining = length
            chunk = 1024 * 256
            while remaining > 0:
                data = f.read(min(chunk, remaining))
                if not data:
                    break
                remaining -= len(data)
                yield data

    rv = Response(generate(), 206, mimetype=mimetype, direct_passthrough=True)
    rv.headers.add("Content-Range", f"bytes {start}-{end}/{file_size}")
    rv.headers.add("Accept-Ranges", "bytes")
    rv.headers.add("Content-Length", str(length))
    rv.headers.add("Cache-Control", "public, max-age=3600")
    return rv


# ------------------------------------------------------------------ #
# Export
# ------------------------------------------------------------------ #


def _escape_csv(value) -> str:
    s = "" if value is None else str(value)
    if any(c in s for c in [",", "\"", "\n", "\r"]):
        return "\"" + s.replace("\"", "\"\"") + "\""
    return s


def export_state(state: dict, library: list[dict], media_index: dict, fmt: str) -> tuple[str, str]:
    """Return (filename, body) for the chosen format."""
    items = []
    for media_id, s in state.items():
        media = media_index.get(media_id, {})
        item = {
            "id": media_id,
            "title": media.get("title", ""),
            "year": media.get("year"),
            "type": media.get("type"),
            "category": media.get("category"),
            "path": media.get("path"),
            "status": s.get("status", ""),
            "rating": s.get("rating"),
            "review": s.get("review", ""),
            "notes": s.get("notes", ""),
            "tags": s.get("tags", []),
            "favorite": s.get("favorite", False),
            "rewatchCount": s.get("rewatchCount", 0),
            "progressSeconds": s.get("progress"),
            "durationSeconds": s.get("duration"),
            "lastWatchedAt": s.get("lastWatchedAt"),
            "addedAt": s.get("addedAt"),
        }
        items.append(item)

    if fmt == "csv":
        headers = [
            "id", "title", "year", "type", "category", "path", "status",
            "rating", "favorite", "rewatchCount", "progressSeconds",
            "durationSeconds", "tags", "review", "notes",
            "lastWatchedAt", "addedAt",
        ]
        lines = [",".join(headers)]
        for it in items:
            row = [_escape_csv(it.get(h)) for h in headers]
            row[headers.index("tags")] = _escape_csv(";".join(it.get("tags") or []))
            lines.append(",".join(row))
        return "cinema-export.csv", "\n".join(lines)

    if fmt == "md":
        lines = ["# Personal Cinema Export", ""]
        for it in items:
            lines.append(f"## {it['title']}" + (f" ({it['year']})" if it.get("year") else ""))
            lines.append("")
            lines.append(f"- **ID**: `{it['id']}`")
            lines.append(f"- **Type**: {it['type']} / {it['category']}")
            lines.append(f"- **Path**: `{it['path']}`")
            if it.get("status"):
                lines.append(f"- **Status**: {it['status']}")
            if it.get("rating") is not None:
                lines.append(f"- **Rating**: {it['rating']}/10")
            if it.get("favorite"):
                lines.append(f"- **Favorite**: yes")
            if it.get("rewatchCount"):
                lines.append(f"- **Rewatch count**: {it['rewatchCount']}")
            if it.get("tags"):
                lines.append(f"- **Tags**: {', '.join(it['tags'])}")
            if it.get("lastWatchedAt"):
                lines.append(f"- **Last watched**: {it['lastWatchedAt']}")
            if it.get("review"):
                lines.append("")
                lines.append("### Review")
                lines.append(it["review"])
            if it.get("notes"):
                lines.append("")
                lines.append("### Notes")
                lines.append(it["notes"])
            lines.append("")
        return "cinema-export.md", "\n".join(lines)

    # JSON (default)
    payload = {
        "exportedAt": int(time.time()),
        "version": 1,
        "items": items,
    }
    return "cinema-export.json", json.dumps(payload, indent=2, ensure_ascii=False)


# ------------------------------------------------------------------ #
# Blueprint factory
# ------------------------------------------------------------------ #


def make_blueprint(get_upload_folder, get_roots=None) -> Blueprint:
    """Build the Flask blueprint.

    `get_upload_folder` is a callable returning the current uploads directory.
    `get_roots` (optional) returns the iterable of cinema root paths relative
    to the upload folder.
    """
    bp = Blueprint("cinema", __name__, url_prefix="/api/cinema")
    roots_getter = get_roots or (lambda: _DEFAULT_ROOTS)
    state_path_holder = {"path": None}

    def _state_path() -> str:
        if state_path_holder["path"] is None:
            state_path_holder["path"] = os.path.join(get_upload_folder(), ".cinema_state.json")
        return state_path_holder["path"]

    def _state_store() -> StateStore:
        return StateStore(_state_path())

    def _library() -> list[dict]:
        return scan_library(get_upload_folder(), roots_getter())

    def _media_index() -> dict:
        return {m["id"]: m for m in _library()}

    # --------- Shared helpers for the playback pipeline ---------

    def _find_file(media_id: str, file_path: str) -> dict | None:
        """Resolve ``media_id`` + ``file_path`` to the matching file record
        in the library, or ``None`` if the request doesn't refer to a known
        playable file. Returns the file dict (with ``browserFriendly`` etc.)."""
        media = next((x for x in _library() if x["id"] == media_id), None)
        if not media:
            return None
        candidates = list(media.get("files") or [])
        for season in media.get("seasons") or []:
            candidates.extend(season.get("episodes") or [])
        for f in candidates:
            if f.get("path") == file_path:
                return f
        return None

    def _hls_url(media_id: str, file_path: str) -> str:
        return (
            f"/api/cinema/hls/{urllib.parse.quote(media_id, safe='')}"
            f"?file={urllib.parse.quote(file_path, safe='')}"
        )

    def _stream_url(media_id: str, file_path: str) -> str:
        return (
            f"/api/cinema/stream/{urllib.parse.quote(media_id, safe='')}"
            f"?file={urllib.parse.quote(file_path, safe='')}"
        )

    def _remux_url(media_id: str, cache_hash: str, file_path: str) -> str:
        return (
            f"/api/cinema/remux/{urllib.parse.quote(media_id, safe='')}"
            f"/{urllib.parse.quote(cache_hash, safe='')}"
            f"?file={urllib.parse.quote(file_path, safe='')}"
        )

    def _play_status(abs_path: str, cache: CacheManager) -> dict:
        """Inspect the remux / HLS state of ``abs_path`` and return a uniform
        ``{"status": "ready"|"running"|"queued"|"unavailable", ...}`` payload.
        Always safe to call."""
        strategy = _playback_strategy_for_path(abs_path)
        if strategy == "transcode":
            # The playlist is generated on the fly; readiness means the fMP4
            # init segment (moov) has been produced and ffmpeg is available.
            if not _ffmpeg_available:
                return {"status": "unavailable", "error": "ffmpeg is not installed"}
            init_path = _generate_hls_init(abs_path, cache)
            if init_path is None:
                return {"status": "error", "error": "Failed to generate HLS init segment"}
            return {"status": "ready", "progress": _hls_progress(init_path)}
        else:
            _, remux_path = cache.remux_path(abs_path)
            if cache.is_valid(abs_path, remux_path):
                cache.touch(remux_path)
                return {"status": "ready", "path": remux_path}
        with _remux_lock:
            job = _remux_jobs.get(abs_path)
        if job and job.get("status") == "running":
            return {"status": "running"}
        if not _ffmpeg_available:
            return {"status": "unavailable", "error": "ffmpeg is not installed"}
        return {"status": "queued"}

    def _playback_strategy_for_path(abs_path: str) -> str:
        """Re-probe a file when the in-memory library entry isn't handy.
        Used by status helpers that only have the absolute source path."""
        meta = _probe_video(abs_path)
        return meta.get("playbackStrategy", "transcode")

    # --------- Public routes ---------

    @bp.get("/library")
    def library():
        try:
            items = _library()
        except Exception as exc:
            return jsonify({"error": f"Failed to scan library: {exc}"}), 500
        state = _state_store().all()
        for m in items:
            m["state"] = state.get(m["id"], {})
        return jsonify({"items": items, "count": len(items)})

    @bp.get("/media/<media_id>")
    def media_detail(media_id):
        items = _library()
        m = next((x for x in items if x["id"] == media_id), None)
        if not m:
            return jsonify({"error": "Media not found"}), 404
        state = _state_store().get(media_id)
        return jsonify({"media": m, "state": state})

    # ------------------ Unified playback entry point ------------------
    # The single endpoint the player should hit on mount. It returns
    # either a ready URL to play immediately, or a "starting/running"
    # response the player polls until remux/transcode is ready.
    @bp.get("/play/<media_id>")
    def play(media_id):
        file_path = request.args.get("file", "")
        f = _find_file(media_id, file_path)
        if not f:
            abort(404)
        abs_path = _file_safe_join(get_upload_folder(), file_path)
        if not abs_path or not os.path.isfile(abs_path):
            abort(404)
        cache = _cache_manager(get_upload_folder())
        # Re-probe at play time so a stale library entry or a replaced file
        # doesn't route a remuxable file into a full transcode.
        meta = _probe_video(abs_path)
        strategy = meta.get("playbackStrategy") or f.get("playbackStrategy") or ("direct" if f.get("browserFriendly") else "transcode")

        # Direct-playable source: serve the original over Range.
        if strategy == "direct":
            return jsonify({
                "kind": "direct",
                "url": _stream_url(media_id, file_path),
                "duration": f.get("duration"),
                "size": f.get("sizeBytes"),
            })

        # Remux path: codec is decodable, container isn't. Run a fast
        # stream-copy remux into the cache and serve the fMP4 directly.
        if strategy in ("remux", "remux-hevc"):
            status = _remux_status(abs_path, cache)
            if status["status"] == "ready":
                cache_hash, _ = cache.remux_path(abs_path)
                return jsonify({
                    "kind": "remux",
                    "url": _remux_url(media_id, cache_hash, file_path),
                    "status": "ready",
                    "duration": f.get("duration"),
                    "size": f.get("sizeBytes"),
                })
            if status["status"] == "unavailable":
                return jsonify({
                    "kind": "unsupported",
                    "status": "unavailable",
                    "error": status.get("error", "Remuxing unavailable"),
                    "download": _stream_url(media_id, file_path),
                }), 409
            return jsonify({
                "kind": "remux",
                "status": status["status"],
                "available": _ffmpeg_available,
            }), 202

        # Transcode path: unsupported codec. Full H.264/AAC transcode into
        # a transient HLS window stored in the managed cache.
        status = _play_status(abs_path, cache)
        if status["status"] != "ready":
            _transcode_status(abs_path, cache)
            status = _play_status(abs_path, cache)
        if status["status"] == "ready":
            body = {
                "kind": "hls",
                "url": _hls_url(media_id, file_path),
                "status": "ready",
            }
            body.update(status.get("progress", {}) and {"progress": status["progress"]} or {})
            return jsonify(body)
        if status["status"] == "unavailable":
            return jsonify({
                "kind": "unsupported",
                "status": "unavailable",
                "error": status.get("error", "Transcoding unavailable"),
                "download": _stream_url(media_id, file_path),
            }), 409
        return jsonify({
            "kind": "hls",
            "status": status["status"],
            "available": _ffmpeg_available,
        }), 202

    @bp.get("/stream/<media_id>")
    def stream_media(media_id):
        file_path = request.args.get("file", "")
        abs_path = resolve_video_path(get_upload_folder(), roots_getter(), media_id, file_path)
        if not abs_path:
            abort(404)
        mimetype, _ = mimetypes.guess_type(abs_path)
        # Matroska / WebM are real mimetypes now thanks to the module-level
        # mimetypes.add_type() calls; never lie and serve MKV as MP4 because
        # the browser will assume H.264 and reject anything else.
        if not mimetype:
            ext = abs_path.rsplit(".", 1)[-1].lower() if "." in abs_path else ""
            mimetype = {
                "mp4": "video/mp4",
                "m4v": "video/mp4",
                "mov": "video/quicktime",
                "webm": "video/webm",
                "mkv": "video/x-matroska",
                "avi": "video/x-msvideo",
            }.get(ext, "application/octet-stream")
        return _range_stream_response(abs_path, mimetype)

    @bp.get("/remux/<media_id>/<cache_hash>")
    def serve_remux(media_id, cache_hash):
        """Serve a cached remuxed fMP4 with Range support.

        The URL carries the source ``file`` path and a ``cache_hash`` derived
        from the source's absolute path + mtime + size. We recompute the hash
        and only serve the cache file when it matches and the sidecar is valid.
        """
        file_path = request.args.get("file", "")
        abs_path = resolve_video_path(get_upload_folder(), roots_getter(), media_id, file_path)
        if not abs_path:
            abort(404)
        cache = _cache_manager(get_upload_folder())
        expected, out_path = cache.remux_path(abs_path)
        if expected != cache_hash or not cache.is_valid(abs_path, out_path):
            abort(404)
        cache.touch(out_path)
        return _range_stream_response(out_path, "video/mp4")

    @bp.get("/hls/<media_id>")
    def stream_hls(media_id):
        """Serve the HLS playlist, the init segment, or any media segment.

        Segments are transcoded on demand the first time they are requested,
        then cached. The playlist is generated on the fly from the source
        duration probed at scan time.
        """
        file_path = request.args.get("file", "")
        abs_path = resolve_video_path(get_upload_folder(), roots_getter(), media_id, file_path)
        if not abs_path:
            abort(404)
        cache = _cache_manager(get_upload_folder())
        _, hls_dir = cache.hls_dir(abs_path)
        rel = request.args.get("path", _HLS_PLAYLIST_NAME).replace("\\", "/")

        # ----- Playlist -------------------------------------------------------
        if rel == _HLS_PLAYLIST_NAME:
            text = _generate_hls_playlist(abs_path, file_path, cache)
            if text is None:
                abort(404)
            file_q = urllib.parse.quote(file_path, safe="")

            def _rewrite_segment(match: "re.Match[str]") -> str:
                ws = match.group(1)
                name = match.group(2).rstrip()
                return f"{ws}?file={file_q}&path={urllib.parse.quote(name, safe='')}"

            text = re.sub(
                r"(^[ \t]*)([\w\-./%]+\.(?:m4s|ts)\s*$)",
                _rewrite_segment,
                text,
                flags=re.MULTILINE,
            )

            def _rewrite_map(match: "re.Match[str]") -> str:
                head = match.group(1)
                init_name = match.group(2)
                new_uri = f"?file={file_q}&path={urllib.parse.quote(init_name, safe='')}"
                return f'{head}{new_uri}"'

            text = re.sub(
                r'(#EXT-X-MAP:[^,\n]*URI=")([^"]+)"',
                _rewrite_map,
                text,
            )
            response = Response(text, mimetype="application/vnd.apple.mpegurl")
            response.headers["Cache-Control"] = "no-cache"
            return response

        # Reject escape attempts; confine requests to the HLS directory.
        candidate = _file_safe_join(hls_dir, rel)
        if not candidate or os.path.commonpath([os.path.abspath(hls_dir), os.path.abspath(candidate)]) != os.path.abspath(hls_dir):
            abort(404)

        # ----- Init segment ---------------------------------------------------
        if rel == _HLS_INIT_NAME:
            init_path = _generate_hls_init(abs_path, cache)
            if not init_path or not os.path.isfile(init_path):
                abort(404)
            response = send_file(init_path, mimetype="video/mp4", conditional=True)
            response.headers["Cache-Control"] = "no-cache"
            return response

        # ----- Media segment --------------------------------------------------
        m = re.match(r"seg-(\d{5})\.m4s$", rel)
        if not m:
            abort(404)
        index = int(m.group(1))
        seg_path = _transcode_hls_segment(abs_path, index, cache)
        if not seg_path or not os.path.isfile(seg_path):
            abort(404)
        response = send_file(seg_path, mimetype="video/iso.segment", conditional=True)
        response.headers["Cache-Control"] = "no-cache"
        return response

    @bp.get("/subtitle/<media_id>")
    def serve_subtitle(media_id):
        file_path = request.args.get("file", "")
        sub_filename = request.args.get("name", "")
        if not sub_filename:
            abort(400)
        abs_path, fmt = resolve_subtitle_path(get_upload_folder(), media_id, file_path, sub_filename)
        if not abs_path:
            abort(404)
        if fmt == "vtt":
            return send_file(abs_path, mimetype="text/vtt", conditional=True)
        # Convert SRT on the fly.
        try:
            with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
                srt = f.read()
        except OSError:
            abort(404)
        vtt = _srt_to_vtt(srt)
        return Response(vtt, mimetype="text/vtt")

    @bp.get("/art/<media_id>")
    def serve_art(media_id):
        kind = request.args.get("kind", "poster")
        name = request.args.get("name", "")
        media = next((x for x in _library() if x["id"] == media_id), None)
        if not media:
            abort(404)
        target_name = name or (media.get("poster") if kind == "poster" else media.get("backdrop"))
        if not target_name:
            abort(404)
        # For loose-file media, the art is stored next to the file (not in a
        # subfolder of the file itself). Compute the right base directory
        # before joining to avoid joining a file path with the art name.
        media_rel = media.get("path") or ""
        full_media = _file_safe_join(get_upload_folder(), media_rel)
        if not full_media:
            abort(404)
        if os.path.isfile(full_media):
            base = os.path.dirname(full_media)
        else:
            base = full_media
        art_path = _file_safe_join(base, target_name)
        if not art_path or not os.path.isfile(art_path):
            abort(404)
        mimetype, _ = mimetypes.guess_type(art_path)
        # ``Cache-Control: no-cache`` + a strong ETag means the browser
        # revalidates on every request using If-None-Match, which is
        # cheap (just a header round-trip) and ensures a freshly
        # uploaded poster/backdrop shows up immediately without the
        # user having to hard-refresh the page.
        try:
            stat = os.stat(art_path)
            etag = f'W/"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
        except OSError:
            etag = None
        response = send_file(art_path, mimetype=mimetype, conditional=True)
        if etag:
            response.headers["ETag"] = etag
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
        return response

    @bp.post("/art/<media_id>")
    def upload_art(media_id):
        """Upload a poster or backdrop image for a media item.

        Form fields:
          - ``kind``: ``poster`` or ``backdrop`` (default ``poster``)
          - ``file``: the image file
        The file is saved into the media's folder using a fixed name
        (``poster.<ext>`` / ``backdrop.<ext>``) so subsequent scans pick it up
        automatically. For loose files (media whose ``path`` is a file, not a
        directory) the image is stored next to the video with a slugged name
        (``<slug>.poster.<ext>``) and the scanner knows to look for it.
        Existing files of the same name are overwritten.
        """
        media = next((x for x in _library() if x["id"] == media_id), None)
        if not media:
            return jsonify({"error": "Media not found"}), 404

        kind = (request.form.get("kind") or "poster").strip().lower()
        if kind not in {"poster", "backdrop"}:
            return jsonify({"error": "kind must be 'poster' or 'backdrop'"}), 400

        upload = request.files.get("file")
        if not upload or not upload.filename:
            return jsonify({"error": "No file provided"}), 400

        original = secure_filename(upload.filename)
        ext = original.rsplit(".", 1)[-1].lower() if "." in original else ""
        if ext not in _IMAGE_EXTS:
            return jsonify({"error": f"Unsupported image type: .{ext}"}), 400

        media_path = media.get("path") or ""
        if not media_path:
            return jsonify({"error": "Media has no path on disk"}), 404

        full_path = _file_safe_join(get_upload_folder(), media_path)
        if not full_path:
            return jsonify({"error": "Media path is not safe"}), 400

        if os.path.isdir(full_path):
            media_dir = full_path
            target_name = f"{kind}.{ext}"
        elif os.path.isfile(full_path):
            # Loose file: keep the art next to the video. The scanner picks
            # up ``<file-slug>.poster.<ext>`` and ``<file-slug>.backdrop.<ext>``
            # for loose-file items.
            media_dir = os.path.dirname(full_path)
            file_stem = os.path.splitext(os.path.basename(full_path))[0]
            file_slug = _slugify(file_stem) or "item"
            target_name = f"{file_slug}.{kind}.{ext}"
        else:
            return jsonify({"error": "Media folder missing on disk"}), 404

        if not os.path.isdir(media_dir):
            return jsonify({"error": "Media folder missing on disk"}), 404

        target_path = os.path.join(media_dir, target_name)
        try:
            upload.save(target_path)
        except OSError as exc:
            return jsonify({"error": f"Failed to write file: {exc}"}), 500

        return jsonify({"ok": True, "kind": kind, "name": target_name})

    @bp.delete("/art/<media_id>")
    def delete_art(media_id):
        """Remove the poster or backdrop image for a media item.

        For folder-style media this deletes ``poster.*`` / ``backdrop.*`` (and
        the legacy ``folder.*`` / ``cover.*`` / ``fanart.*`` / ``banner.*``
        names). For loose-file media it deletes ``<file-slug>.poster.*`` /
        ``<file-slug>.backdrop.*`` (and a few common aliases for safety).
        """
        kind = (request.args.get("kind") or "poster").strip().lower()
        if kind not in {"poster", "backdrop"}:
            return jsonify({"error": "kind must be 'poster' or 'backdrop'"}), 400
        media = next((x for x in _library() if x["id"] == media_id), None)
        if not media:
            return jsonify({"error": "Media not found"}), 404

        media_path = media.get("path") or ""
        full_path = _file_safe_join(get_upload_folder(), media_path) if media_path else None
        if not full_path:
            return jsonify({"error": "Media path is not safe"}), 400

        is_loose = full_path and os.path.isfile(full_path)
        media_dir = os.path.dirname(full_path) if is_loose else full_path
        if not media_dir or not os.path.isdir(media_dir):
            return jsonify({"error": "Media folder missing on disk"}), 404

        if is_loose:
            file_stem = os.path.splitext(os.path.basename(full_path))[0]
            file_slug = _slugify(file_stem) or "item"
            candidates = [
                f"{file_slug}.{kind}.{ext}" for ext in _IMAGE_EXTS
            ]
            # Also clear any unsuffixed art sitting in the same folder — the
            # user might have dropped a `poster.jpg` directly via SFTP and
            # we'd otherwise leave it orphaned.
            candidates += [f"{kind}.{ext}" for ext in _IMAGE_EXTS]
        else:
            candidates = [f"{kind}.{ext}" for ext in _IMAGE_EXTS]
            if kind == "poster":
                candidates += ["folder.jpg", "folder.png", "cover.jpg", "cover.png"]
            else:
                candidates += ["fanart.jpg", "fanart.png", "banner.jpg", "banner.png"]

        removed = []
        for name in candidates:
            p = os.path.join(media_dir, name)
            if os.path.isfile(p):
                try:
                    os.remove(p)
                    removed.append(name)
                except OSError:
                    pass
        return jsonify({"ok": True, "removed": removed})

    # --------- Screenshots ---------
    #
    # Screenshots are stored next to the media (folder-level for folder-style
    # items, prefixed with the file slug for loose files). The naming
    # convention matches the scanner:
    #
    #   folder:    screenshot.jpg, screenshot-1.jpg, screenshot-2.jpg, ...
    #   loose:     <slug>.screenshot.jpg,   <slug>.screenshot-1.jpg,   ...

    def _media_dir_for(media: dict) -> tuple[str | None, str | None]:
        """Return ``(media_dir_abs, expected_slug_or_None)`` for a media item.

        ``media_dir_abs`` is the folder where screenshots / art live.
        ``expected_slug`` is set for loose-file media so the scanner
        can find the right ``<slug>.screenshot-N.<ext>`` files; for
        folder-style media the convention is just ``screenshot-N.<ext>``.
        """
        media_path = media.get("path") or ""
        full_path = _file_safe_join(get_upload_folder(), media_path) if media_path else None
        if not full_path:
            return None, None
        if os.path.isfile(full_path):
            slug = _slugify(os.path.splitext(os.path.basename(full_path))[0]) or "item"
            return os.path.dirname(full_path), slug
        if os.path.isdir(full_path):
            return full_path, None
        return None, None

    @bp.get("/screenshots/<media_id>")
    def list_or_serve_screenshot(media_id):
        """List screenshots for ``media_id`` or serve a single one with ``?name=``.

        - No ``name`` query param → returns JSON ``{"items": [...], "count": N}``.
        - ``name=<file>`` → returns the image bytes (with ETag / no-cache).
        """
        media = next((x for x in _library() if x["id"] == media_id), None)
        if not media:
            abort(404)
        media_dir, slug = _media_dir_for(media)
        if not media_dir or not os.path.isdir(media_dir):
            return jsonify({"items": []})

        name = (request.args.get("name") or "").strip()

        # Serve a single screenshot when ``name`` is given.
        if name:
            safe_name = secure_filename(name)
            if not safe_name or safe_name != name or not _SCREENSHOT_RE.match(name):
                abort(404)
            target = _file_safe_join(media_dir, safe_name)
            if not target or not os.path.isfile(target):
                abort(404)
            mimetype, _ = mimetypes.guess_type(target)
            try:
                stat = os.stat(target)
                etag = f'W/"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
            except OSError:
                etag = None
            response = send_file(target, mimetype=mimetype, conditional=True)
            if etag:
                response.headers["ETag"] = etag
            response.headers["Cache-Control"] = "no-cache, must-revalidate"
            return response

        # Otherwise list everything.
        detected = _detect_screenshots(media_dir, file_basename=f"{slug}.mkv" if slug else None)
        items = _attach_screenshot_urls(detected, media_id)
        return jsonify({"items": items, "count": len(items)})

    @bp.post("/screenshots/<media_id>")
    def upload_screenshot(media_id):
        """Upload one or more screenshots. Multipart ``files`` field.

        The new image is assigned the next free ``screenshot-N.<ext>``
        (or ``<slug>.screenshot-N.<ext>`` for loose files). The same
        file may be uploaded multiple times; the index just keeps
        incrementing so existing screenshots aren't overwritten.
        """
        media = next((x for x in _library() if x["id"] == media_id), None)
        if not media:
            return jsonify({"error": "Media not found"}), 404
        media_dir, slug = _media_dir_for(media)
        if not media_dir or not os.path.isdir(media_dir):
            return jsonify({"error": "Media folder missing on disk"}), 404

        uploads = request.files.getlist("files")
        if not uploads:
            upload = request.files.get("file")
            if upload and upload.filename:
                uploads = [upload]
        if not uploads:
            return jsonify({"error": "No files provided"}), 400

        # Count existing screenshots once so we can reject up front and
        # pick fresh indices without re-scanning the folder per upload.
        existing = _detect_screenshots(
            media_dir,
            file_basename=f"{slug}.mkv" if slug else None,
        )
        used_indices = {s["index"] for s in existing}
        prefix = f"{slug}.screenshot" if slug else "screenshot"
        slots_left = max(0, _SCREENSHOT_MAX_PER_MEDIA - len(existing))

        saved: list[dict] = []
        skipped = 0
        for upload in uploads:
            if not upload.filename:
                continue
            original = secure_filename(upload.filename)
            ext = original.rsplit(".", 1)[-1].lower() if "." in original else ""
            if ext not in _IMAGE_EXTS:
                continue
            if slots_left <= 0:
                # Per-media cap reached — accept the rest of the batch as
                # no-ops so a multi-file drop doesn't partially apply and
                # we can tell the UI which ones were ignored.
                skipped += 1
                continue
            next_idx = 0
            while next_idx in used_indices:
                next_idx += 1
            target_name = f"{prefix}-{next_idx}.{ext}" if next_idx > 0 else f"{prefix}.{ext}"
            target_path = os.path.join(media_dir, target_name)
            try:
                upload.save(target_path)
            except OSError as exc:
                return jsonify({"error": f"Failed to write file: {exc}"}), 500
            try:
                size = os.path.getsize(target_path)
            except OSError:
                size = 0
            saved.append({"name": target_name, "index": next_idx, "size": size})
            used_indices.add(next_idx)
            slots_left -= 1
        if not saved:
            if skipped:
                return jsonify({
                    "error": f"Maximum of {_SCREENSHOT_MAX_PER_MEDIA} screenshots per media item",
                    "max": _SCREENSHOT_MAX_PER_MEDIA,
                }), 400
            return jsonify({"error": "No valid image files provided"}), 400
        return jsonify({
            "ok": True,
            "saved": saved,
            "skipped": skipped,
            "max": _SCREENSHOT_MAX_PER_MEDIA,
        })

    @bp.delete("/screenshots/<media_id>")
    def delete_screenshot(media_id):
        """Remove a single screenshot. ``?name=<file>`` selects which one."""
        media = next((x for x in _library() if x["id"] == media_id), None)
        if not media:
            return jsonify({"error": "Media not found"}), 404
        media_dir, slug = _media_dir_for(media)
        if not media_dir or not os.path.isdir(media_dir):
            return jsonify({"error": "Media folder missing on disk"}), 404
        name = (request.args.get("name") or "").strip()
        if not name:
            return jsonify({"error": "name query parameter required"}), 400
        # Reject path traversal and reject anything that doesn't match
        # the expected screenshot naming convention.
        safe_name = secure_filename(name)
        if not safe_name or safe_name != name:
            return jsonify({"error": "Invalid screenshot name"}), 400
        if not _SCREENSHOT_RE.match(name):
            return jsonify({"error": "Filename does not match screenshot naming convention"}), 400
        if slug:
            # Per-file media: name must be prefixed with the right slug.
            if not name.startswith(f"{slug}."):
                return jsonify({"error": "Screenshot does not belong to this media"}), 400
        else:
            # Folder media: name must NOT be slug-prefixed.
            if "." in name and name.split(".", 1)[0] != "screenshot":
                return jsonify({"error": "Screenshot does not belong to this media"}), 400
        target = os.path.join(media_dir, safe_name)
        # Final safety check.
        if not os.path.isfile(target):
            return jsonify({"error": "Screenshot not found"}), 404
        try:
            os.remove(target)
        except OSError as exc:
            return jsonify({"error": f"Failed to delete: {exc}"}), 500
        return jsonify({"ok": True, "removed": safe_name})

    @bp.get("/screenshots/file/<media_id>")
    def serve_screenshot(media_id):
        """Deprecated alias — kept for back-compat. Prefer ``GET /screenshots/<id>?name=``."""
        return list_or_serve_screenshot(media_id)

    @bp.get("/state")
    def get_state():
        return jsonify({"state": _state_store().all()})

    @bp.get("/state/<media_id>")
    def get_one_state(media_id):
        return jsonify({"state": _state_store().get(media_id)})

    @bp.post("/state/<media_id>")
    def upsert_state(media_id):
        data = request.get_json(silent=True) or {}
        # Validate
        allowed_status = {"none", "watching", "completed", "dropped", "plan"}
        if "status" in data and data["status"] not in allowed_status:
            return jsonify({"error": f"status must be one of {sorted(allowed_status)}"}), 400
        if "rating" in data and data["rating"] is not None:
            try:
                r = float(data["rating"])
            except (TypeError, ValueError):
                return jsonify({"error": "rating must be a number"}), 400
            if r < 0 or r > 10:
                return jsonify({"error": "rating must be between 0 and 10"}), 400
            data["rating"] = r
        if "tags" in data and data["tags"] is not None:
            if not isinstance(data["tags"], list):
                return jsonify({"error": "tags must be an array"}), 400
        if "progress" in data and data["progress"] is not None:
            try:
                p = float(data["progress"])
            except (TypeError, ValueError):
                return jsonify({"error": "progress must be a number"}), 400
            if p < 0:
                p = 0
            data["progress"] = p
        if "duration" in data and data["duration"] is not None:
            try:
                d = float(data["duration"])
            except (TypeError, ValueError):
                return jsonify({"error": "duration must be a number"}), 400
            if d < 0:
                d = 0
            data["duration"] = d
        merged = _state_store().upsert(media_id, data)
        return jsonify({"state": merged})

    @bp.delete("/state/<media_id>")
    def delete_state(media_id):
        ok = _state_store().delete(media_id)
        return jsonify({"deleted": ok})

    @bp.get("/export")
    def export():
        fmt = (request.args.get("format", "json") or "json").lower()
        if fmt not in {"json", "csv", "md", "markdown"}:
            return jsonify({"error": "format must be one of json, csv, md"}), 400
        if fmt == "markdown":
            fmt = "md"
        items = _library()
        index = {m["id"]: m for m in items}
        filename, body = export_state(_state_store().all(), items, index, fmt)
        mimetype = {
            "json": "application/json; charset=utf-8",
            "csv": "text/csv; charset=utf-8",
            "md": "text/markdown; charset=utf-8",
        }[fmt]
        return Response(
            body,
            mimetype=mimetype,
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
        )

    @bp.get("/roots")
    def roots():
        return jsonify({"roots": list(roots_getter())})

    @bp.get("/transcode/<media_id>")
    def transcode_status(media_id):
        """Legacy status endpoint — delegates to the unified play pipeline."""
        file_path = request.args.get("file", "")
        abs_path = resolve_video_path(get_upload_folder(), roots_getter(), media_id, file_path)
        if not abs_path:
            abort(404)
        cache = _cache_manager(get_upload_folder())
        body = _play_status(abs_path, cache)
        body["available"] = _probe_tools()[0]
        body["hls"] = body.get("status") == "ready"
        if body["hls"]:
            _, hls = cache.hls_dir(abs_path)
            playlist = os.path.join(hls, _HLS_PLAYLIST_NAME)
            if os.path.isfile(playlist):
                rel = os.path.relpath(playlist, get_upload_folder()).replace("\\", "/")
                body["hlsPath"] = rel
        return jsonify(body)

    @bp.get("/health")
    def health():
        ffmpeg, ffprobe = _probe_tools()
        return jsonify({
            "ffmpeg": ffmpeg,
            "ffprobe": ffprobe,
            "transcoding": ffmpeg and ffprobe,
        })

    @bp.post("/transcode/<media_id>")
    def trigger_transcode(media_id):
        """Legacy trigger endpoint — kicks off (or re-runs) the HLS transcode."""
        file_path = request.args.get("file", "")
        force = request.args.get("force") in ("1", "true", "yes")
        abs_path = resolve_video_path(get_upload_folder(), roots_getter(), media_id, file_path)
        if not abs_path:
            abort(404)
        cache = _cache_manager(get_upload_folder())
        return jsonify(_transcode_status(abs_path, cache, force=force))

    # --------- MKV → MP4 persistent conversion ---------
    #
    # Unlike ``/transcode`` which streams a transient HLS window, this
    # endpoint writes a sibling ``.mp4`` next to the source. The scanner
    # picks it up on the next refresh and the player serves it directly
    # with zero CPU.

    def _resolve_convert_source(media_id: str, file_path: str) -> str | None:
        """Resolve a convert request to the source file on disk.

        The library dedupes ``Movie.mkv`` against ``Movie.mp4`` so after a
        conversion completes, the library no longer lists the MKV. Use the
        raw ``file_path`` (validated to be inside a cinema root) so the
        caller can still poll status, kick off the job, or delete the
        converted sibling.
        """
        if not file_path:
            return None
        abs_path = _file_safe_join(get_upload_folder(), file_path.replace("\\", "/"))
        if not abs_path or not os.path.isfile(abs_path):
            return None
        # Sanity check: must be inside one of the cinema roots.
        for root in roots_getter():
            root_abs = os.path.abspath(os.path.join(get_upload_folder(), root.replace("\\", "/")))
            if os.path.commonpath([root_abs, os.path.abspath(abs_path)]) == root_abs:
                return abs_path
        return None

    @bp.get("/convert/<media_id>")
    def convert_status(media_id):
        """Return the current convert job state for ``media_id`` + ``file``.

        Includes the output path, mode (``copy`` / ``hw:<encoder>`` /
        ``sw:libx264``), progress bytes, and any error message.
        """
        file_path = request.args.get("file", "")
        abs_path = _resolve_convert_source(media_id, file_path)
        if not abs_path:
            abort(404)
        force = request.args.get("force") in ("1", "true", "yes")
        body = _convert_status(abs_path, force=force)
        # Surface the hardware encoder so the UI can show "GPU accelerated".
        body["hwEncoder"] = _detect_hw_encoder()
        return jsonify(body)

    @bp.post("/convert/<media_id>")
    def convert_trigger(media_id):
        """Kick off (or re-run) a conversion. Idempotent."""
        file_path = request.args.get("file", "")
        abs_path = _resolve_convert_source(media_id, file_path)
        if not abs_path:
            abort(404)
        force = request.args.get("force") in ("1", "true", "yes")
        return jsonify(_convert_status(abs_path, force=force))

    @bp.delete("/convert/<media_id>")
    def convert_cancel(media_id):
        """Cancel an in-flight job and remove the (partial or finished) output."""
        file_path = request.args.get("file", "")
        abs_path = _resolve_convert_source(media_id, file_path)
        if not abs_path:
            abort(404)
        # Two flavours: ``?cancel=1`` cancels an in-flight job, plain DELETE
        # just removes the finished output. Both are useful from the UI.
        if request.args.get("cancel") in ("1", "true", "yes"):
            return jsonify(_convert_cancel(abs_path))
        return jsonify(_convert_delete_output(abs_path))

    return bp