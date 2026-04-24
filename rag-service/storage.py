import os
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

from config import (
    S3_ENDPOINT_URL,
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY,
    AWS_REGION
)


def _client():
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT_URL,    # None for real AWS S3
        aws_access_key_id=AWS_ACCESS_KEY_ID,
        aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
        region_name=AWS_REGION,    # always "us-east-1" for Supabase
    )


def upload_dir(local_path, bucket=None, key=None):
    client = _client()
    for file in Path(local_path).rglob("*"):
        if file.is_file():
            relative = file.relative_to(local_path)
            object_key = f"{key}/{relative}"
            client.upload_file(str(file), bucket, object_key)


def download_dir(bucket=None, key=None, target=None):
    client = _client()
    paginator = client.get_paginator("list_objects_v2")
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
