# storage is a module that provides functions for interacting with object storage services. In this code, we import upload_dir, download_dir, and object_exists from the storage module. These functions are likely implemented using libraries such as boto3 for AWS S3, gcsfs for Google Cloud Storage, or azure-sdk for Azure Blob Storage. The upload_dir function is used to upload a local directory (containing the FAISS index) to the specified bucket and key in object storage. The download_dir function is used to download a directory from object storage to a local path. The object_exists function checks if a specific object (FAISS index) exists in the object storage at the given bucket and key. These functions allow us to manage the storage of FAISS indexes in the cloud, enabling us to load and save vector stores as needed.
from pathlib import Path
import boto3
# boto3 is the AWS SDK for Python, which allows us to interact with AWS services such as S3. In this code, we use boto3 to create a client for S3 and perform operations like uploading files, downloading files, and checking if an object exists in the S3 bucket. The _client function initializes the S3 client with the necessary credentials and endpoint URL, which can be configured for different environments (e.g., local development with MinIO or production with AWS S3). The upload_dir function uses the S3 client to upload files from a local directory to the specified bucket and key in S3. The download_dir function uses the S3 client to download files from S3 to a local directory. The object_exists function uses the S3 client to check if a specific object exists in the S3 bucket by listing objects with the given prefix.
from botocore.exceptions import ClientError
# ClientError is an exception class from the botocore library, which is a low-level interface to AWS services used by boto3. In this code, we import ClientError to handle exceptions that may occur when interacting with S3. For example, in the object_exists function, if there's an error while trying to list objects in the S3 bucket (e.g., due to permissions issues, network errors, or if the bucket doesn't exist), a ClientError will be raised. We catch this exception and return False, indicating that the object does not exist or there was an issue accessing it. This allows us to handle errors gracefully without crashing the application.

# TODOs : ensure correct error handling and logging in all functions, especially for upload and download operations which can fail due to various reasons (e.g., network issues, permission errors, etc.). We should also consider adding retries with exponential backoff for transient errors to improve robustness. Additionally, we may want to add functionality for deleting objects or directories from the storage if needed in the future.

from config import (
    S3_ENDPOINT_URL,
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    AWS_REGION
)


_s3_client = None


# singleton ptn used here. is it ideal?
def _client():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client(
            "s3",
            endpoint_url=S3_ENDPOINT_URL,
            aws_access_key_id=AWS_ACCESS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
            region_name=AWS_REGION
        )
    return _s3_client


def upload_dir(local_path, bucket=None, key=None):
    client = _client()
    for file in Path(local_path).rglob("*"):   # rglob is used to recursively find all files in the local_path directory and its subdirectories. We then upload each file to the specified bucket and key in S3, maintaining the directory structure by using the relative path of each file from the local_path as part of the object key in S3.
        if file.is_file():
            relative = file.relative_to(local_path)   # Get the relative path of the file with respect to the local_path. This allows us to maintain the directory structure when uploading to S3. For example, if local_path is "/data/faiss_index" and we have a file at "/data/faiss_index/subdir/file.idx", the relative path will be "subdir/file.idx". We can then use this relative path to construct the object key in S3, ensuring that the file is stored in the correct "subdirectory" within the bucket.
            object_key = f"{key}/{relative}"
            client.upload_file(str(file), bucket, object_key)


def download_dir(bucket=None, key=None, target=None):
    client = _client()
    paginator = client.get_paginator("list_objects_v2")    # We use a paginator to handle cases where there are many objects in the bucket with the specified prefix (key). The list_objects_v2 API call can return a limited number of objects (up to 1000) in a single response, so if there are more objects than that, we need to paginate through the results to get all of them. The paginator allows us to iterate through all the pages of results seamlessly, ensuring that we download all relevant files from S3 to the target local directory.
    for page in paginator.paginate(Bucket=bucket, Prefix=key):
        for obj in page.get("Contents", []):
            relative = obj["Key"][len(key):].lstrip("/")
            dest = Path(target) / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            client.download_file(bucket, obj["Key"], str(dest))


def object_exists(bucket=None, key=None):
    client = _client()
    try:
        response = client.list_objects_v2(Bucket=bucket, Prefix=key, MaxKeys=1)
        return response.get("KeyCount", 0) > 0
    except ClientError:
        return False
