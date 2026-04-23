"""
Adapted from the YouTube RAG vector_store.py — but stores FAISS in object
storage (no long-lived local disk). Accepts repo or contributor text.
"""

import os
# os is a standard Python library that provides a way to interact with the operating system. 
# In this code, we use os.makedirs to create a temporary directory for storing the FAISS index 
# TODOs : before uploading it to object storage. The os module also provides functions for handling file paths and other operating system-related tasks.
import tempfile
# tempfile is a standard Python library that provides functions for creating temporary files and directories. In this code, we use tempfile.TemporaryDirectory to create a temporary directory that will be automatically cleaned up after we are done using it. This is useful for storing the FAISS index locally before uploading it to object storage, without having to worry about manually deleting the temporary files afterward.
# TODOs : will it still be used if we setup the cloud storage? i think so, because we still need to save the FAISS index locally before uploading it to object storage, and we can use tempfile to manage the temporary directory for that purpose, ensuring that it is properly cleaned up after use.
from pathlib import Path
# pathlib is a standard Python library that provides an object-oriented interface for working with file system paths. In this code, we use pathlib.Path to handle file paths in a more convenient and readable way. For example, we can easily create directories, join paths, and manipulate file paths using the Path class. This helps
from typing import Optional
# typing is a standard Python library that provides support for type hints. In this code, we use Optional from the typing module to indicate that a function may return either a FAISS object or None. This helps improve code readability and allows for better static type checking.
from langchain_text_splitters import RecursiveCharacterTextSplitter
# langchain_text_splitters is a library that provides various text splitting strategies for processing large documents. In this code, we use RecursiveCharacterTextSplitter to split the input text into smaller chunks that can be processed by the FAISS vector store. The RecursiveCharacterTextSplitter allows us to specify a chunk size and overlap, which helps ensure that the chunks are of manageable size while still retaining some context between them.
from langchain_huggingface import HuggingFaceEmbeddings
# langchain_huggingface is a library that provides integration with Hugging Face models for generating embeddings. In this code, we use HuggingFaceEmbeddings to create an embedding model based on the "all-MiniLM-L6-v2" model from Hugging Face. This embedding model will be used to convert the text chunks into vector representations that can be stored in the FAISS vector store for efficient retrieval.
#  look at other embedding models available in Hugging Face and see if there are any that might be better suited for our use case, such as code-specific embedding models.
from langchain_community.vectorstores import FAISS
# langchain_community.vectorstores is a library that provides support for various vector store implementations, including FAISS. In this code, we use the FAISS class to create and manage a FAISS vector store, which allows us to efficiently store and retrieve vector representations of text chunks. The FAISS vector store will be used to index the embeddings generated from the input text, enabling us to perform similarity searches when retrieving relevant documents based on user queries.
# FAISS stands for Facebook AI Similarity Search, and it is a library that provides efficient algorithms for indexing and searching large collections of high-dimensional vectors. By using FAISS, we can quickly retrieve relevant documents based on the similarity of their vector representations, which is essential for building a RAG (Retrieval-Augmented Generation) system that can provide accurate and relevant responses to user queries.
from config import VECTOR_STORE_BUCKET, VECTOR_STORE_PREFIX, VECTOR_STORE_TMP
# config is a module that contains configuration settings for the application. In this code, we import VECTOR_STORE_BUCKET, VECTOR_STORE_PREFIX, and VECTOR_STORE_TMP from the config module. These variables likely contain the bucket name for object storage, the prefix for storing FAISS indexes in the object storage, and the temporary directory path for storing FAISS indexes locally before uploading them to object storage, respectively. By centralizing these configuration settings in a separate module, we can easily manage and update them without having to modify the main codebase.
from storage import upload_dir, download_dir, object_exists  # implement with boto3/gcsfs/azure-sdk?
# storage is a module that provides functions for interacting with object storage services. In this code, we import upload_dir, download_dir, and object_exists from the storage module. These functions are likely implemented using libraries such as boto3 for AWS S3, gcsfs for Google Cloud Storage, or azure-sdk for Azure Blob Storage. The upload_dir function is used to upload a local directory (containing the FAISS index) to the specified bucket and key in object storage. The download_dir function is used to download a directory from object storage to a local path. The object_exists function checks if a specific object (FAISS index) exists in the object storage at the given bucket and key. These functions allow us to manage the storage of FAISS indexes in the cloud, enabling us to load and save vector stores as needed.


EMBEDDINGS = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
# EMBEDDINGS is an instance of the HuggingFaceEmbeddings class, which is initialized with the "all-MiniLM-L6-v2" model from Hugging Face. This embedding model will be used to convert text chunks into vector representations that can be stored in the FAISS vector store. By using this specific model, we can generate high-quality embeddings that capture the semantic meaning of the text, which will improve the performance of similarity searches when retrieving relevant documents based on user queries.


def _object_key(repo_id: str, scope: str) -> str:
    """Return the object-storage key for a given repo + scope."""
    return f"{VECTOR_STORE_PREFIX}/{repo_id}/{scope}.faiss"
# TODOs : idts we're keeping scope
# The _object_key function is a helper function that constructs the object storage key for a given repository ID and scope. The key is formed by combining the VECTOR_STORE_PREFIX, the repo_id, and the scope (which can be either "repo" or a contributor login) with a ".faiss" extension. This key will be used to store and retrieve the FAISS index in object storage, allowing us to manage multiple vector stores for different repositories and contributors in an organized manner.


def create_vector_store(text: str, repo_id: str, scope: str = "repo") -> FAISS:
    # -> FAISS indicates that this function returns an instance of the FAISS class, which represents the created vector store. The function takes in the input text, the repository ID, and an optional scope (defaulting to "repo") to create a FAISS vector store from the provided text and upload it to object storage for later retrieval.
    """
    Create a FAISS vector store from text, then upload it to object storage.
    `scope` is either 'repo' or a contributor login like 'octocat'.
    """
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
    )
    # The RecursiveCharacterTextSplitter is initialized with a chunk size of 1000 characters and an overlap of 200 characters. This means that the input text will be split into chunks of up to 1000 characters, with an overlap of 200 characters between consecutive chunks. The overlap helps to ensure that important context is not lost when splitting the text, which can improve the quality of the embeddings and the performance of similarity searches in the FAISS vector store.
    chunks = splitter.create_documents([text])
    # The create_documents method of the splitter is called with a list containing the input text. This method processes the input text and splits it into smaller chunks based on the specified chunk size and overlap. The resulting chunks are returned as a list of document objects, which can then be used to create the FAISS vector store by generating embeddings for each chunk and indexing them in the vector store.

    vector_store = FAISS.from_documents(chunks, EMBEDDINGS)
    # FAISS.from_documents is a class method that creates a FAISS vector store from a list of document objects (chunks) and an embedding model (EMBEDDINGS). This method generates embeddings for each chunk using the specified embedding model and indexes them in the FAISS vector store, allowing for efficient similarity searches based on the content of the chunks.

    object_key = _object_key(repo_id, scope)
    # The _object_key function is called with the repo_id and scope to generate the object storage key for the FAISS index. This key will be used to upload the FAISS index to object storage, allowing us to manage and retrieve it later based on the repository ID and scope.
    os.makedirs(VECTOR_STORE_TMP, exist_ok=True)
    # os.makedirs is used to create the temporary directory specified by VECTOR_STORE_TMP if it does not already exist. The exist_ok=True parameter allows the function to succeed even if the directory already exists, preventing any errors from being raised in that case. This temporary directory will be used to store the FAISS index locally before uploading it to object storage.

    with tempfile.TemporaryDirectory(dir=VECTOR_STORE_TMP) as tmp:
        path = Path(tmp) / "index"
        # A temporary directory is created using tempfile.TemporaryDirectory, and the path variable is set to a subdirectory called "index" within that temporary directory. This path will be used to save the FAISS index locally before uploading it to object storage. The use of a temporary directory ensures that any files created during this process will be automatically cleaned up after we are done, preventing clutter and potential issues with leftover files on the local filesystem.
        path.parent.mkdir(parents=True, exist_ok=True)
        # path.parent.mkdir is used to create the parent directory of the specified path if it does not already exist. The parents=True parameter allows the function to create any necessary parent directories along the specified path, and exist_ok=True allows the function to succeed without raising an error if the directory already exists. This ensures that the directory structure needed to save the FAISS index is in place before we attempt to save it.
        vector_store.save_local(str(path))
        # vector_store.save_local is a method that saves the FAISS index to a local directory specified by the path variable. This method takes care of writing the necessary files to disk to represent the FAISS index, allowing us to later upload this directory to object storage for persistent storage and retrieval.
        upload_dir(str(path), bucket=VECTOR_STORE_BUCKET, key=object_key)
        # upload_dir is a function that uploads the local directory containing the FAISS index to the specified bucket and key in object storage. This allows us to store the FAISS index in the cloud, making it accessible for later retrieval when we need to load the vector store for a specific repository and scope.

    return vector_store
# Finally, the created FAISS vector store is returned from the function, allowing the caller to use it immediately after creation if needed. This function encapsulates the entire process of creating a FAISS vector store from input text, saving it locally, uploading it to object storage, and returning the vector store instance for further use in the application.
# store is cloud storage? Yes, in this context, "object storage" refers to a type of cloud storage that allows you to store and manage data as objects. This is different from traditional file storage or block storage. Object storage is designed for scalability and durability, making it suitable for storing large amounts of unstructured data, such as the FAISS indexes we are creating in this code. By using object storage, we can easily manage and retrieve our FAISS indexes based on repository ID and scope without having to worry about local disk space or persistence issues.


def load_vector_store(repo_id: str, scope: str = "repo") -> Optional[FAISS]:
    #  optional return type indicates that this function may return either a FAISS object or None. The function takes in a repository ID and an optional scope (defaulting to "repo") to attempt to load a FAISS vector store from object storage. If the specified FAISS index exists in object storage, it will be downloaded and loaded into a FAISS object, which is then returned. If the index does not exist, the function returns None, indicating that there is no existing vector store for the given repository and scope.
    """Load a FAISS index from object storage, or return None if missing."""
    object_key = _object_key(repo_id, scope)

    if not object_exists(bucket=VECTOR_STORE_BUCKET, key=object_key):
        return None
    os.makedirs(VECTOR_STORE_TMP, exist_ok=True)

    with tempfile.TemporaryDirectory(dir=VECTOR_STORE_TMP) as tmp:
        path = Path(tmp) / "index"
        download_dir(bucket=VECTOR_STORE_BUCKET, key=object_key, target=str(path))
        return FAISS.load_local(
            str(path),
            EMBEDDINGS,
            allow_dangerous_deserialization=True,
        )
    # we need to download the FAISS index from object storage to a local temporary directory before we can load it into a FAISS object. The download_dir function is used to download the directory containing the FAISS index from object storage to the specified local path. Once the index is downloaded, we can use FAISS.load_local to load the index into a FAISS object, which can then be used for similarity searches and other operations in our application. The allow_dangerous_deserialization=True parameter is used to allow loading of potentially unsafe data, which may be necessary in this context since we are loading a FAISS index that was created and stored by our own application.
# but do we also download after creating first embedding? won't it be expensive?
# what exactly is returned from load_vector_store? The load_vector_store function returns an instance of the FAISS class that represents the loaded vector store if the specified FAISS index exists in object storage. If the index does not exist, it returns None. The returned FAISS object can be used to perform similarity searches and other operations on the indexed embeddings, allowing us to retrieve relevant documents based on user queries. However, if the index is not found in object storage, returning None allows the caller to handle this case appropriately, such as by creating a new vector store from the input text.
# object shape is : {"status": "ok", "latest_sha": latest_sha, "repo_faiss_uri": repo_faiss_uri}


def get_or_create_vector_store(
    text: str, repo_id: str, scope: str = "repo"
) -> FAISS:
    """Load from storage if available, otherwise create and upload."""
    vs = load_vector_store(repo_id, scope)
    if vs is not None:
        return vs
    return create_vector_store(text, repo_id, scope)
