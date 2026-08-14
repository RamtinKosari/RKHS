import os
import json
import shutil
from pathlib import Path
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename

from cinema import make_blueprint as make_cinema_blueprint

app = Flask(__name__)
CORS(app)  # Enables cross-origin requests from your frontend

# Configure your local storage path
UPLOAD_FOLDER = os.path.abspath("./uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
TEMP_TEXT_FILE = os.path.join(UPLOAD_FOLDER, ".temp_shared_text.txt")
PASSWORDS_FILE = os.path.join(UPLOAD_FOLDER, ".folder_passwords.json")

# Roots the Cinema tab scans (relative to UPLOAD_FOLDER).
# All cinema content lives under `Videos/Cinema/` — categories such as
# Movies, Series, Documentaries, etc. are subfolders of that root.
CINEMA_ROOTS = ("Videos/Cinema",)
app.register_blueprint(
    make_cinema_blueprint(lambda: UPLOAD_FOLDER, lambda: CINEMA_ROOTS)
)


def load_passwords():
    if os.path.exists(PASSWORDS_FILE):
        try:
            with open(PASSWORDS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def save_passwords(passwords):
    with open(PASSWORDS_FILE, "w", encoding="utf-8") as f:
        json.dump(passwords, f, indent=2)


def get_password_hash(password):
    # Simple hash for basic protection. For stronger security, use bcrypt/argon2.
    import hashlib
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def secure_path(relative_path):
    """Resolve a relative path safely under UPLOAD_FOLDER. Returns None if invalid."""
    if not relative_path:
        return UPLOAD_FOLDER
    # Normalize separators
    relative_path = relative_path.replace("\\", "/")
    parts = relative_path.split("/")
    safe_parts = [secure_filename(part) for part in parts if part and part not in (".", "..")]
    if not safe_parts:
        return UPLOAD_FOLDER
    full_path = os.path.abspath(os.path.join(UPLOAD_FOLDER, *safe_parts))
    # Ensure resolved path is still inside UPLOAD_FOLDER
    if os.path.commonpath([UPLOAD_FOLDER, full_path]) != UPLOAD_FOLDER:
        return None
    return full_path


def relative_from_full(full_path):
    """Return the path of full_path relative to UPLOAD_FOLDER."""
    try:
        rel = os.path.relpath(full_path, UPLOAD_FOLDER)
        return "" if rel == "." else rel.replace("\\", "/")
    except ValueError:
        return ""


# Helper to determine file type category
def get_file_type(filename):
    ext = filename.rsplit(".", 1)[1].lower() if "." in filename else ""
    if ext in ["pdf", "txt", "docx", "md"]:
        return "pdf"
    elif ext in ["py", "js", "ts", "cpp", "h", "json", "yml", "yaml", "sh", "css", "html", "tsx"]:
        return "code"
    elif ext in ["csv", "xlsx", "xls"]:
        return "spreadsheet"
    elif ext in ["png", "jpg", "jpeg", "gif", "webp"]:
        return "image"
    elif ext in ["mp4", "webm", "ogg", "mov"]:
        return "video"
    elif ext in ["mp3", "wav", "m4a", "aac"]:
        return "audio"
    return "pdf"


# Helper to format file size nicely
def format_size(size_in_bytes):
    if size_in_bytes < 1024:
        return f"{size_in_bytes} B"
    elif size_in_bytes < 1024 * 1024:
        return f"{size_in_bytes / 1024:.1f} KB"
    else:
        return f"{size_in_bytes / (1024 * 1024):.1f} MB"


def folder_has_password(relative_folder):
    passwords = load_passwords()
    return passwords.get(relative_folder) is not None


def _list_directory(dir_path):
    """Return list of file and folder entries inside dir_path."""
    items = []
    if not os.path.exists(dir_path):
        return items

    passwords = load_passwords()

    for idx, entry in enumerate(sorted(os.listdir(dir_path))):
        if entry.startswith("."):
            continue
        entry_path = os.path.join(dir_path, entry)
        rel = relative_from_full(entry_path)
        if os.path.isdir(entry_path):
            items.append({
                "id": f"dir-{idx}",
                "name": entry,
                "type": "folder",
                "path": rel,
                "uploader": "Ramtin",
                "updatedAt": str(os.path.getmtime(entry_path)),
                "locked": passwords.get(rel) is not None,
            })
        else:
            stat = os.stat(entry_path)
            items.append({
                "id": f"file-{idx}",
                "name": entry,
                "size": format_size(stat.st_size),
                "sizeBytes": stat.st_size,
                "type": get_file_type(entry),
                "path": rel,
                "uploader": "Ramtin",
                "updatedAt": str(os.path.getmtime(entry_path))
            })
    return items


def _recursive_file_stats():
    """Recursively gather stats for all files for analytics."""
    counts = {"pdf": 0, "code": 0, "spreadsheet": 0, "image": 0, "video": 0, "audio": 0}
    sizes = {"pdf": 0, "code": 0, "spreadsheet": 0, "image": 0, "video": 0, "audio": 0}
    if not os.path.exists(UPLOAD_FOLDER):
        return counts, sizes

    for root, _dirs, files in os.walk(UPLOAD_FOLDER):
        for filename in files:
            if filename.startswith("."):
                continue
            file_path = os.path.join(root, filename)
            try:
                stat = os.stat(file_path)
                ftype = get_file_type(filename)
                if ftype in counts:
                    counts[ftype] += 1
                    sizes[ftype] += stat.st_size / (1024 * 1024)
            except OSError:
                continue
    return counts, sizes


@app.route("/api/files", methods=["GET"])
def get_files():
    path = request.args.get("path", "")
    dir_path = secure_path(path)
    if dir_path is None:
        return jsonify({"error": "Invalid path"}), 400

    items = _list_directory(dir_path)
    counts, sizes = _recursive_file_stats()

    return jsonify({
        "items": items,
        "currentPath": relative_from_full(dir_path),
        "stats": {
            "counts": counts,
            "sizes": {k: round(v, 2) for k, v in sizes.items()}
        }
    })


@app.route("/api/upload", methods=["POST"])
def upload_file():
    target_path = request.form.get("path", "")
    target_dir = secure_path(target_path)
    if target_dir is None:
        return jsonify({"error": "Invalid path"}), 400
    os.makedirs(target_dir, exist_ok=True)

    uploaded_files = request.files.getlist("files")
    if not uploaded_files or all(f.filename == "" for f in uploaded_files):
        return jsonify({"error": "No files provided"}), 400

    saved = []
    skipped = []
    for file in uploaded_files:
        if file.filename == "":
            continue
        filename = secure_filename(file.filename)
        dest = os.path.join(target_dir, filename)
        # Avoid overwriting: append number if exists
        if os.path.exists(dest):
            base, ext = os.path.splitext(filename)
            counter = 1
            while os.path.exists(dest):
                candidate = f"{base} ({counter}){ext}"
                dest = os.path.join(target_dir, candidate)
                counter += 1
            filename = os.path.basename(dest)
        file.save(dest)
        saved.append(filename)

    return jsonify({"message": "Upload complete", "saved": saved}), 200


@app.route("/api/download", methods=["GET"])
def download_file():
    path = request.args.get("path", "")
    file_path = secure_path(path)
    if file_path is None or not os.path.isfile(file_path):
        return jsonify({"error": "File not found"}), 404

    directory = os.path.dirname(file_path)
    filename = os.path.basename(file_path)
    return send_from_directory(directory, filename, as_attachment=True)


@app.route("/api/files", methods=["DELETE"])
def delete_file():
    path = request.args.get("path", "")
    file_path = secure_path(path)
    if file_path is None or not os.path.isfile(file_path):
        return jsonify({"error": "File not found"}), 404

    os.remove(file_path)
    return jsonify({"message": "File deleted successfully"}), 200


@app.route("/api/folders", methods=["POST"])
def create_folder():
    data = request.json or {}
    parent = data.get("path", "")
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Folder name required"}), 400

    safe_name = secure_filename(name)
    if not safe_name:
        return jsonify({"error": "Invalid folder name"}), 400

    parent_dir = secure_path(parent)
    if parent_dir is None:
        return jsonify({"error": "Invalid path"}), 400

    new_folder = os.path.join(parent_dir, safe_name)
    if os.path.exists(new_folder):
        return jsonify({"error": "Folder already exists"}), 409

    os.makedirs(new_folder)
    return jsonify({"message": "Folder created", "name": safe_name}), 200


@app.route("/api/folders", methods=["PUT"])
def rename_folder():
    data = request.json or {}
    path = data.get("path", "")
    new_name = data.get("newName", "").strip()
    if not new_name:
        return jsonify({"error": "New folder name required"}), 400

    safe_new_name = secure_filename(new_name)
    if not safe_new_name:
        return jsonify({"error": "Invalid folder name"}), 400

    old_folder = secure_path(path)
    if old_folder is None or not os.path.isdir(old_folder):
        return jsonify({"error": "Folder not found"}), 404

    parent_dir = os.path.dirname(old_folder)
    new_folder = os.path.join(parent_dir, safe_new_name)
    if os.path.exists(new_folder):
        return jsonify({"error": "A folder with that name already exists"}), 409

    # Update stored password entries to follow renamed folder
    old_rel = relative_from_full(old_folder)
    new_rel = relative_from_full(new_folder)
    passwords = load_passwords()
    updated_passwords = {}
    for k, v in passwords.items():
        if k == old_rel or k.startswith(old_rel + "/"):
            new_key = new_rel + k[len(old_rel):]
            updated_passwords[new_key] = v
        else:
            updated_passwords[k] = v
    save_passwords(updated_passwords)

    os.rename(old_folder, new_folder)
    return jsonify({"message": "Folder renamed", "newName": safe_new_name}), 200


@app.route("/api/folders", methods=["DELETE"])
def delete_folder():
    path = request.args.get("path", "")
    folder_path = secure_path(path)
    if folder_path is None or not os.path.isdir(folder_path):
        return jsonify({"error": "Folder not found"}), 404

    if folder_path == UPLOAD_FOLDER:
        return jsonify({"error": "Cannot delete root upload folder"}), 403

    # Remove stored password entries for this folder and its children
    folder_rel = relative_from_full(folder_path)
    passwords = load_passwords()
    updated_passwords = {k: v for k, v in passwords.items()
                         if k != folder_rel and not k.startswith(folder_rel + "/")}
    save_passwords(updated_passwords)

    shutil.rmtree(folder_path)
    return jsonify({"message": "Folder deleted successfully"}), 200


@app.route("/api/files", methods=["PUT"])
def rename_file():
    data = request.json or {}
    path = data.get("path", "")
    new_name = data.get("newName", "").strip()
    if not new_name:
        return jsonify({"error": "New file name required"}), 400

    safe_new_name = secure_filename(new_name)
    if not safe_new_name:
        return jsonify({"error": "Invalid file name"}), 400

    old_file = secure_path(path)
    if old_file is None or not os.path.isfile(old_file):
        return jsonify({"error": "File not found"}), 404

    parent_dir = os.path.dirname(old_file)
    new_file = os.path.join(parent_dir, safe_new_name)
    if os.path.exists(new_file):
        return jsonify({"error": "A file with that name already exists"}), 409

    os.rename(old_file, new_file)
    return jsonify({"message": "File renamed", "newName": safe_new_name}), 200


@app.route("/api/move", methods=["POST"])
def move_items():
    data = request.json or {}
    sources = data.get("sources", [])
    destination = data.get("destination", "")

    if not sources:
        return jsonify({"error": "No items selected"}), 400

    dest_dir = secure_path(destination)
    if dest_dir is None or not os.path.isdir(dest_dir):
        return jsonify({"error": "Destination folder not found"}), 404

    dest_rel = relative_from_full(dest_dir)
    moved = []
    errors = []

    for src in sources:
        src_path = secure_path(src)
        if src_path is None or not os.path.exists(src_path):
            errors.append(f"{src}: not found")
            continue

        src_rel = relative_from_full(src_path)
        # Prevent moving a folder into itself or its own children
        if dest_rel == src_rel or dest_rel.startswith(src_rel + "/"):
            errors.append(f"{src}: cannot move into itself")
            continue

        name = os.path.basename(src_path)
        dest = os.path.join(dest_dir, name)
        if os.path.exists(dest):
            base, ext = os.path.splitext(name)
            counter = 1
            while os.path.exists(dest):
                candidate = f"{base} ({counter}){ext}"
                dest = os.path.join(dest_dir, candidate)
                counter += 1
            name = os.path.basename(dest)

        new_rel = relative_from_full(dest)
        # Update password entries when moving a folder
        if os.path.isdir(src_path):
            passwords = load_passwords()
            updated = {}
            for k, v in passwords.items():
                if k == src_rel or k.startswith(src_rel + "/"):
                    updated[new_rel + k[len(src_rel):]] = v
                else:
                    updated[k] = v
            save_passwords(updated)

        shutil.move(src_path, dest)
        moved.append(relative_from_full(dest))

    return jsonify({"message": "Move complete", "moved": moved, "errors": errors}), 200


@app.route("/api/copy", methods=["POST"])
def copy_items():
    data = request.json or {}
    sources = data.get("sources", [])
    destination = data.get("destination", "")

    if not sources:
        return jsonify({"error": "No items selected"}), 400

    dest_dir = secure_path(destination)
    if dest_dir is None or not os.path.isdir(dest_dir):
        return jsonify({"error": "Destination folder not found"}), 404

    copied = []
    errors = []

    for src in sources:
        src_path = secure_path(src)
        if src_path is None or not os.path.exists(src_path):
            errors.append(f"{src}: not found")
            continue

        name = os.path.basename(src_path)
        dest = os.path.join(dest_dir, name)
        if os.path.exists(dest):
            base, ext = os.path.splitext(name)
            counter = 1
            while os.path.exists(dest):
                candidate = f"{base} (copy {counter}){ext}"
                dest = os.path.join(dest_dir, candidate)
                counter += 1
            name = os.path.basename(dest)

        try:
            if os.path.isdir(src_path):
                shutil.copytree(src_path, dest)
            else:
                shutil.copy2(src_path, dest)
            copied.append(relative_from_full(dest))
        except Exception as e:
            errors.append(f"{src}: {str(e)}")

    return jsonify({"message": "Copy complete", "copied": copied, "errors": errors}), 200


@app.route("/api/folders/tree", methods=["GET"])
def get_folder_tree():
    """Return a nested tree of all folders for navigation/move dialogs."""
    def build_tree(dir_path):
        nodes = []
        if not os.path.isdir(dir_path):
            return nodes
        for entry in sorted(os.listdir(dir_path)):
            if entry.startswith("."):
                continue
            full = os.path.join(dir_path, entry)
            if os.path.isdir(full):
                rel = relative_from_full(full)
                nodes.append({
                    "name": entry,
                    "path": rel,
                    "children": build_tree(full)
                })
        return nodes

    return jsonify(build_tree(UPLOAD_FOLDER))


@app.route("/api/folders/password", methods=["POST"])
def set_folder_password():
    data = request.json or {}
    path = data.get("path", "")
    password = data.get("password", "")

    folder_path = secure_path(path)
    if folder_path is None or not os.path.isdir(folder_path):
        return jsonify({"error": "Folder not found"}), 404

    if not password:
        return jsonify({"error": "Password required"}), 400

    folder_rel = relative_from_full(folder_path)
    passwords = load_passwords()
    passwords[folder_rel] = get_password_hash(password)
    save_passwords(passwords)
    return jsonify({"message": "Password set"}), 200


@app.route("/api/folders/password", methods=["DELETE"])
def remove_folder_password():
    path = request.args.get("path", "")
    folder_path = secure_path(path)
    if folder_path is None or not os.path.isdir(folder_path):
        return jsonify({"error": "Folder not found"}), 404

    folder_rel = relative_from_full(folder_path)
    passwords = load_passwords()
    if folder_rel in passwords:
        del passwords[folder_rel]
        save_passwords(passwords)
    return jsonify({"message": "Password removed"}), 200


@app.route("/api/folders/unlock", methods=["POST"])
def unlock_folder():
    data = request.json or {}
    path = data.get("path", "")
    password = data.get("password", "")

    folder_path = secure_path(path)
    if folder_path is None or not os.path.isdir(folder_path):
        return jsonify({"error": "Folder not found"}), 404

    folder_rel = relative_from_full(folder_path)
    passwords = load_passwords()
    stored_hash = passwords.get(folder_rel)
    if stored_hash is None:
        return jsonify({"unlocked": True}), 200

    if not password:
        return jsonify({"error": "Password required"}), 400

    if stored_hash == get_password_hash(password):
        return jsonify({"unlocked": True}), 200
    return jsonify({"error": "Incorrect password"}), 401


@app.route('/api/text', methods=['GET'])
def get_shared_text():
    if os.path.exists(TEMP_TEXT_FILE):
        with open(TEMP_TEXT_FILE, "r", encoding="utf-8") as f:
            content = f.read()
        return jsonify({"text": content})
    return jsonify({"text": ""})


@app.route('/api/text', methods=['POST'])
def save_shared_text():
    data = request.json
    text_content = data.get("text", "")
    with open(TEMP_TEXT_FILE, "w", encoding="utf-8") as f:
        f.write(text_content)
    return jsonify({"status": "success"})


@app.route("/api/content", methods=["GET"])
def get_file_content():
    path = request.args.get("path", "")
    file_path = secure_path(path)
    if file_path is None or not os.path.isfile(file_path):
        return jsonify({"error": "File not found"}), 404

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
        return jsonify({"content": content})
    except Exception:
        return jsonify({"content": "Binary or unreadable file text format."})


if __name__ == "__main__":
    # Runs publicly on your network so your laptop/clients can reach it
    app.run(host="0.0.0.0", port=5000, debug=True)
