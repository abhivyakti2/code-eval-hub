import os   # os is a module that provides a way of using operating system dependent functionality, such as reading environment variables and working with file paths.
import tempfile
from dotenv import load_dotenv

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
VECTOR_STORE_BUCKET = os.getenv("VECTOR_STORE_BUCKET")  # e.g., s3 bucket / gcs bucket / minio bucket
VECTOR_STORE_PREFIX = os.getenv("VECTOR_STORE_PREFIX", "vector-stores")
S3_ENDPOINT_URL = os.getenv("S3_ENDPOINT_URL")        # blank = real AWS S3
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_REGION = os.getenv("AWS_REGION", "auto")      # "auto" works for R2

DEFAULT_TMP = os.path.join(tempfile.gettempdir(), "vector-stores")
VECTOR_STORE_TMP = os.getenv("VECTOR_STORE_TMP", DEFAULT_TMP)
