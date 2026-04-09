import os
import shutil

import tempfile
BASE = os.path.join(tempfile.gettempdir(), "vector-stores")
os.makedirs(BASE, exist_ok=True)


def _full_path(key):
    return os.path.join(BASE, key)


def upload_dir(local_path, bucket=None, key=None):
    dest = _full_path(key)
    os.makedirs(dest, exist_ok=True)
    shutil.copytree(local_path, dest, dirs_exist_ok=True)


def download_dir(bucket=None, key=None, target=None):
    src = _full_path(key)
    shutil.copytree(src, target, dirs_exist_ok=True)


def object_exists(bucket=None, key=None):
    return os.path.exists(_full_path(key))