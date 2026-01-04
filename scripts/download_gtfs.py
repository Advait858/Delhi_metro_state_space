import argparse
import hashlib
import os
import urllib.request
import zipfile


def download(url: str, dest: str) -> None:
    with urllib.request.urlopen(url) as response:
        data = response.read()
    with open(dest, "wb") as f:
        f.write(data)


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True, help="GTFS zip URL")
    parser.add_argument("--out-dir", required=True, help="Output directory")
    parser.add_argument("--checksum", help="Expected SHA256 checksum")
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    zip_path = os.path.join(args.out_dir, "gtfs.zip")
    download(args.url, zip_path)

    if args.checksum:
        actual = sha256(zip_path)
        if actual.lower() != args.checksum.lower():
            raise SystemExit(f"Checksum mismatch: {actual}")

    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(args.out_dir)


if __name__ == "__main__":
    main()
