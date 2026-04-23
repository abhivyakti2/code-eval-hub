"""
Adapts transcript_loader.py for GitHub repositories.
Instead of fetching a YouTube transcript (a single text),
we fetch all code files from a GitHub repo and return them
as a list of (path, content) tuples — the equivalent of
document chunks at the source level.
"""

import httpx
# httpx is an HTTP client library for Python that allows us to make HTTP requests to the GitHub API to fetch repository data, such as file metadata, file contents, and commit information. We use httpx to interact with the GitHub API endpoints and retrieve the necessary data for building our repository text and contributor-specific text.
import base64
# base64 is a module in Python that provides functions for encoding and decoding data using the Base64 encoding scheme. In this code, we use base64 to decode the content of files fetched from the GitHub API, which are often returned in Base64-encoded format. By decoding the content, we can obtain the original text of the files, which can then be used to build our repository text and contributor-specific text for further processing and analysis.
from config import GITHUB_TOKEN
# config is like .env? Yes, in this context, config is likely a Python module that contains configuration settings for the application, including the GITHUB_TOKEN variable. This token is used for authenticating requests to the GitHub API, allowing us to access private repositories and avoid rate limits that apply to unauthenticated requests. By storing the token in a separate config module, we can keep sensitive information like API keys and tokens out of our main codebase and easily manage them in one place.

HEADERS = {
    "Authorization": f"Bearer {GITHUB_TOKEN}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}
# HEADERS is a dictionary that contains the HTTP headers to be included in each request made to the GitHub API. The "Authorization" header includes the GITHUB_TOKEN for authentication, allowing us to access private repositories and avoid rate limits. The "Accept" header specifies that we want to receive responses in JSON format, and the "X-GitHub-Api-Version" header specifies the version of the GitHub API we want to use for our requests. By defining these headers in a single dictionary, we can easily include them in all our API requests without having to repeat the same headers multiple times throughout our code.

DIFF_HEADERS = {
    **HEADERS,
    "Accept": "application/vnd.github.v3.diff",
}

MAX_FILE_SIZE = 500_000  # 500 KB — skip very large files
# but what if those files are important? we might miss important context. True, setting a maximum file size is a trade-off between including potentially important context and avoiding performance issues that can arise from processing very large files. In practice, you may want to adjust this threshold based on the specific needs of your application and the typical size of files in the repositories you are working with. If you find that important context is being missed due to the file size limit, you could consider increasing the threshold or implementing additional logic to selectively include larger files based on their relevance or importance to the repository's functionality.
#  TODOs : check what size is typical for code files in GitHub repos, and adjust this threshold accordingly. Also, consider implementing a way to include larger files if they are deemed important based on certain criteria (e.g., file type, recent changes, etc.).

# File extensions to include (source code only)
INCLUDE_EXTENSIONS = {
    ".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".java", ".rs",
    ".cpp", ".c", ".cs", ".rb", ".php", ".swift", ".kt", ".md",
    ".yaml", ".yml", ".json", ".toml", ".env.example", ".sh",
}
# TODOs : but can't we just use all files? what if we're missing extentions due to hardcoding? True, hardcoding a list of file extensions can lead to missing important files that don't fit the specified extensions. One way to address this issue is to allow for a more flexible approach, such as including all files by default and then applying filters based on file size or other criteria rather than relying solely on file extensions. Alternatively, you could implement a configuration option that allows users to specify additional file extensions they want to include, giving them more control over the types of files that are processed while still maintaining a reasonable default set of extensions for common source code files. This way, you can ensure that you are not missing important context while still managing performance and relevance effectively.


def fetch_file_tree(owner: str, repo: str, sha: str = "HEAD") -> list[dict]:
    """Return list of file metadata dicts from the repo tree."""
    url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/{sha}?recursive=1"
    #  what is f? Yes, the f-string syntax allows us to easily construct the URL for the GitHub API request by embedding the owner, repo, and sha variables directly into the string. This makes it more readable and convenient to create the URL without having to concatenate strings or use other formatting methods. The resulting URL will be used to fetch the file tree metadata for the specified repository and commit SHA, allowing us to retrieve information about all the files in the repository at that specific point in time.
    r = httpx.get(url, headers=HEADERS, timeout=30)
    #  returns httpx.Response object, which contains the HTTP response from the GitHub API. This response includes the status code, headers, and the body of the response, which is expected to be in JSON format containing the file tree metadata for the specified repository and commit SHA. We can then check the status code and parse the JSON content to extract the relevant information about the files in the repository.
    r.raise_for_status()
    # raise_for_status() is a method provided by the httpx library that checks the HTTP response status code. If the status code indicates an error (e.g., 4xx or 5xx), this method will raise an HTTPError exception, allowing us to handle errors gracefully in our code. By calling r.raise_for_status() after making the API request, we can ensure that any issues with the request (such as authentication errors, rate limits, or other server errors) are caught and handled appropriately, rather than allowing the code to continue executing with an invalid response.
    data = r.json()
    return [
        item for item in data.get("tree", [])  # [] is default value if "tree" key is not present in the response data
        # for each item in the "tree" list of the response data, we check if the item is a file (type "blob"), if its size is less than the specified MAX_FILE_SIZE, and if its path ends with one of the extensions in the INCLUDE_EXTENSIONS set. If all these conditions are met, we include the item's metadata in the returned list. This filtering ensures that we only process relevant source code files that are not too large, allowing us to build our repository text efficiently while still capturing important context from the files in the repository.
        if item["type"] == "blob"
        and item.get("size", 0) < MAX_FILE_SIZE
        and any(item["path"].endswith(ext) for ext in INCLUDE_EXTENSIONS)
    ]
    # tuple comprehension is used to create a list of file metadata dictionaries that meet the specified criteria. Each dictionary in the returned list contains information about a file in the repository, such as its path, size, and type, which can then be used to fetch the file content and build the repository text for further processing.


def fetch_file_content(owner: str, repo: str, path: str) -> str:
    """Fetch and decode a single file's content."""
    url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}"
    r = httpx.get(url, headers=HEADERS, timeout=30)
    if r.status_code != 200:
        return ""
    # TODOs : why not return the error?
    data = r.json()
    if data.get("encoding") == "base64":
        # why do we check encoding? The GitHub API returns file content in Base64-encoded format when fetching file contents. By checking the "encoding" field in the response data, we can determine if the content is encoded in Base64 and needs to be decoded before we can use it. If the encoding is indeed "base64", we use the base64 module to decode the content and return it as a UTF-8 string. If the encoding is not specified or is different, we assume that the content is already in a usable format and return it directly from the "content" field of the response data. This ensures that we correctly handle the file content regardless of its encoding, allowing us to build our repository text accurately.
        return base64.b64decode(data["content"]).decode("utf-8", errors="replace")
    # content field is returned by the GitHub API when fetching file contents, and it contains the actual content of the file. If the content is Base64-encoded, we decode it using base64.b64decode and then decode the resulting bytes into a UTF-8 string. The errors="replace" parameter in the decode method ensures that any decoding errors are handled gracefully by replacing invalid byte sequences with a placeholder character, allowing us to retrieve as much of the file content as possible without encountering exceptions that could disrupt our application flow. If the encoding is not Base64, we simply return the content as it is, assuming it is already in a usable format.
    # replace means? The errors="replace" parameter in the decode method is used to specify how to handle any decoding errors that may occur when converting the Base64-decoded bytes into a UTF-8 string. If there are any invalid byte sequences that cannot be decoded as UTF-8, using errors="replace" will replace those invalid sequences with a placeholder character (usually a question mark "?") instead of raising an exception. This allows the decoding process to continue and return a string even if there are some issues with the content, ensuring that we can still retrieve and use as much of the file content as possible without encountering errors that would disrupt the flow of our application.
    return data.get("content", "")


def fetch_commits_by_contributor(
    owner: str, repo: str, login: str, since: str | None = None
) -> list[dict]:          # can we skip passing since?
    """Fetch commit messages for a contributor — equivalent of transcript for that person."""
    url = f"https://api.github.com/repos/{owner}/{repo}/commits"
    params = {"author": login, "per_page": 100}
    # The params dictionary is used to specify query parameters for the API request to fetch commits from the GitHub API. The "author" parameter is set to the login of the contributor whose commits we want to retrieve, and "per_page" is set to 100 to specify that we want to retrieve up to 100 commits per page of results. If the since parameter is provided, it will be added to the params dictionary to filter commits based on their creation date, allowing us to fetch only recent commits made by the specified contributor. These parameters help us tailor our API request to get the relevant commit data for building the contributor-specific text.
    if since:
        params["since"] = since

    r = httpx.get(url, headers=HEADERS, params=params, timeout=30)

    r.raise_for_status()
    data = r.json()

    return data
# but commit messages don't give all information about their code contributions. 
# TODOs : fetch all diffs for their commits


def fetch_commit_diff(owner: str, repo: str, sha: str) -> str:
    """Fetch raw unified diff for a single commit."""
    url = f"https://api.github.com/repos/{owner}/{repo}/commits/{sha}"
    r = httpx.get(url, headers=DIFF_HEADERS, timeout=30)
    if r.status_code != 200:
        return ""
    return r.text


def build_repo_text(owner: str, repo: str) -> str:
    """
    Build a single concatenated text from all source files.
    This is the GitHub equivalent of a YouTube transcript.
    Each file is prefixed with its path so the LLM understands context.
    """
    files = fetch_file_tree(owner, repo)
    parts = []
    for f in files:
        content = fetch_file_content(owner, repo, f["path"])
        if content.strip():
            parts.append(f"### FILE: {f['path']}\n\n{content}\n")
    return "\n\n".join(parts)
# here text means? embedding of code? or summary of code? or something else? In this context, "text" refers to the concatenated content of all the source files in the GitHub repository, with each file's content prefixed by its path for context. This text is not an embedding or a summary, but rather the raw content of the files as they are fetched and combined into a single string. This combined text can then be used as input for further processing, such as generating embeddings for similarity search or providing context for language models when answering questions about the repository.


def build_contributor_text(owner: str, repo: str, login: str) -> str:
    """
    Build contributor-specific text from their commit diffs.
    Equivalent of a transcript scoped to one contributor.
    """
    commits = fetch_commits_by_contributor(owner, repo, login)
#   TODOs : should get for all commits after since right?
    lines = [f"Contributor: {login}", f"Total commits: {len(commits)}", ""]
    for commit in commits:
        msg = commit.get("commit", {}).get("message", "")
        # what's the empty {} for? The empty dictionaries {} in the get method calls are used to provide a default value in case the expected keys ("commit" and "message") are not present in the commit dictionary. This prevents KeyError exceptions from being raised if the structure of the commit data is different than expected. By using get with a default value, we can safely attempt to access nested keys without worrying about missing data, allowing our code to be more robust and handle cases where certain information may not be available in the commit data.
        date = commit.get("commit", {}).get("author", {}).get("date", "")
        # .get is used to safely access nested keys in the commit dictionary. The first .get("commit", {}) attempts to access the "commit" key, and if it doesn't exist, it returns an empty dictionary {}. Then, on that result, we call .get("author", {}) to access the "author" key, and if it doesn't exist, it again returns an empty dictionary {}. Finally, we call .get("date", "") on the result to access the "date" key, and if it doesn't exist, it returns an empty string "". This way, we can safely navigate through the nested structure of the commit data without risking KeyError exceptions if any of the expected keys are missing.
        sha = commit.get("sha", "")
        diff = fetch_commit_diff(owner, repo, sha) if sha else ""
        if diff:
            # Keep diff chunks bounded so embedding/retrieval context size remains stable.
            diff = diff[:12000]
            lines.append(f"[{date}] {msg}\nSHA: {sha}\nDIFF:\n{diff}\n")
        else:
            # Fallback to message-only context if diff fetch fails for this commit.
            lines.append(f"[{date}] {msg}\nSHA: {sha}\n")
        # why is date in curly braces{}? The curly braces {} are used for string formatting in Python. In this case, f"[{date}] {msg}" creates a formatted string where {date} and {msg} are replaced with the actual values of the date and msg variables. The date is enclosed in square brackets [] to visually separate it from the commit message, making it easier to read and understand that the date corresponds to the commit message that follows it. This formatting choice helps to organize the contributor-specific text in a clear and structured way, allowing us to easily identify the date of each commit along with its corresponding message.
    return "\n".join(lines)


# TODOs : this should be done in next before request
def get_latest_sha(owner: str, repo: str) -> str:
    url = f"https://api.github.com/repos/{owner}/{repo}/commits/HEAD"
    r = httpx.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()["sha"]
