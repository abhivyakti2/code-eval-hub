import os
import tempfile
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")

# S3-compatible object storage (Supabase Storage / AWS S3 / MinIO)
VECTOR_STORE_BUCKET = os.getenv("VECTOR_STORE_BUCKET")
VECTOR_STORE_PREFIX = os.getenv("VECTOR_STORE_PREFIX", "vector-stores")

S3_ENDPOINT_URL = os.getenv("S3_ENDPOINT_URL")        # e.g. https://<project>.supabase.co/storage/v1/s3
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")     # Supabase Storage access key
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")  # Supabase Storage secret key
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")      # Supabase Storage always uses us-east-1

DEFAULT_TMP = os.path.join(tempfile.gettempdir(), "vector-stores")
VECTOR_STORE_TMP = os.getenv("VECTOR_STORE_TMP", DEFAULT_TMP)
