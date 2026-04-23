import os
import shutil
# shutil is used for copying directories, os is used for path manipulations and checking existence of files/directories

import tempfile
BASE = os.path.join(tempfile.gettempdir(), "vector-stores")
os.makedirs(BASE, exist_ok=True)


def _full_path(key):
    return os.path.join(BASE, key)
# This function constructs the full path for a given key by joining it with the base directory. It ensures that all operations are performed within the designated temporary directory for vector stores.


def upload_dir(local_path, bucket=None, key=None):
    dest = _full_path(key)
    os.makedirs(dest, exist_ok=True)
    shutil.copytree(local_path, dest, dirs_exist_ok=True)
# This function uploads a directory from the local path to the destination path constructed using the key. It creates the destination directory if it doesn't exist and copies all contents from the local path to the destination, allowing for existing directories to be overwritten if necessary.


def download_dir(bucket=None, key=None, target=None):
    src = _full_path(key)
    shutil.copytree(src, target, dirs_exist_ok=True)
# This function downloads a directory from the source path constructed using the key to the target path. It copies all contents from the source to the target, allowing for existing directories at the target location to be overwritten if necessary.


def object_exists(bucket=None, key=None):
    return os.path.exists(_full_path(key))
# This function checks if an object (directory) exists at the path constructed using the key. It returns True if the path exists and False otherwise.