import os   # os is a module that provides a way of using operating system dependent functionality, such as reading environment variables and working with file paths.
import tempfile
from dotenv import load_dotenv

load_dotenv()
# stored where after loading? in the environment variables of the process, so we can access them using os.getenv().

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

# difference beteen os and dotenv: os is a built-in module in Python that provides a way to interact with the operating system, while dotenv is a third-party library that allows you to read key-value pairs from a .env file and set them as environment variables. In this code, we use dotenv to load environment variables from a .env file, and then we use os.getenv to access those variables in our code.
# no way to directly access .env variables without loading them into environment variables, because .env is just a file that contains key-value pairs, and it doesn't have any functionality to make those variables available in the code. We need to use a library like dotenv to read the .env file and set the variables as environment variables, which can then be accessed using os.getenv or other similar functions in Python.

# each variable is used for :
# GROQ_API_KEY: API key for accessing the GROQ service i.e. for generating summaries and embeddings
# GITHUB_TOKEN: Token for authenticating with the GitHub API
# VECTOR_STORE_BUCKET: The bucket name where vector stores(i.e. FAISS indexes) are stored
# VECTOR_STORE_PREFIX: The prefix for organizing vector stores within the bucket i.e. it can be used to create a folder-like structure in the bucket for better organization of vector stores
# S3_ENDPOINT_URL: The endpoint URL for the S3-compatible storage service, supabase R2 in this case, if using AWS S3, this can be left blank or set to the default AWS S3 endpoint.
# AWS_ACCESS_KEY_ID: The access key ID for AWS credentials
# AWS_SECRET_ACCESS_KEY: The secret access key for AWS credentials
# AWS_REGION: The region for AWS services
# DEFAULT_TMP: The default temporary directory for vector stores locally
# VECTOR_STORE_TMP: The temporary directory for vector stores (overrides DEFAULT_TMP)