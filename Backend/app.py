import os
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename

app = Flask(__name__)
CORS(app)  # Enables cross-origin requests from your frontend

# Configure your local storage path
UPLOAD_FOLDER = os.path.abspath("./uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
TEMP_TEXT_FILE = os.path.join(UPLOAD_FOLDER, ".temp_shared_text.txt")

# Helper to determine file type category
def get_file_type(filename):
    ext = filename.rsplit(".", 1)[1].lower() if "." in filename else ""
    if ext in ["pdf", "txt", "docx", "md"]:
        return "pdf"
    elif ext in ["py", "js", "ts", "cpp", "h", "json"]:
        return "code"
    elif ext in ["csv", "xlsx", "xls"]:
        return "spreadsheet"
    elif ext in ["png", "jpg", "jpeg", "gif", "webp"]:
        return "image"
    elif ext in ["mp4", "webm", "ogg", "mov"]:
        return "video"
    return "pdf"

# Helper to format file size nicely
def format_size(size_in_bytes):
    if size_in_bytes < 1024:
        return f"{size_in_bytes} B"
    elif size_in_bytes < 1024 * 1024:
        return f"{size_in_bytes / 1024:.1f} KB"
    else:
        return f"{size_in_bytes / (1024 * 1024):.1f} MB"

@app.route("/api/files", methods=["GET"])
def get_files():
    files_list = []
    if not os.path.exists(UPLOAD_FOLDER):
        return jsonify(files_list)

    for idx, filename in enumerate(os.listdir(UPLOAD_FOLDER)):
        if filename == ".temp_shared_text.txt":
            continue
        file_path = os.path.join(UPLOAD_FOLDER, filename)
        if os.path.isfile(file_path):
            stat = os.stat(file_path)
            files_list.append({
                "id": str(idx + 1),
                "name": filename,
                "size": format_size(stat.st_size),
                "type": get_file_type(filename),
                "uploader": "Ramtin",  # Can be extended to read headers/auth
                "updatedAt": str(os.path.getmtime(file_path))
            })
            
    return jsonify(files_list)

@app.route("/api/upload", methods=["POST"])
def upload_file():
    if "file" not in request.files:
        return jsonify({"error": "No file part provided"}), 400
    
    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No selected file"}), 400
    
    filename = secure_filename(file.filename)
    file.save(os.path.join(app.config["UPLOAD_FOLDER"], filename))
    
    return jsonify({"message": "File uploaded successfully", "filename": filename}), 200

@app.route("/api/download/<filename>", methods=["GET"])
def download_file(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename, as_attachment=True)

@app.route("/api/files/<filename>", methods=["DELETE"])
def delete_file(filename):
    file_path = os.path.join(UPLOAD_FOLDER, secure_filename(filename))
    if os.path.exists(file_path):
        os.remove(file_path)
        return jsonify({"message": "File deleted successfully"}), 200
    return jsonify({"error": "File not found"}), 404

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

if __name__ == "__main__":
    # Runs publicly on your network so your laptop/clients can reach it
    app.run(host="0.0.0.0", port=5000, debug=True)