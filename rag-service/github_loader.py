"""
Adapts transcript_loader.py for GitHub repositories.
Instead of fetching a YouTube transcript (a single text),
we fetch all code files from a GitHub repo and return them
as a list of (path, content) tuples — the equivalent of
document chunks at the source level.
"""

import httpx
import base64
from config import GITHUB_TOKEN

HEADERS = {
    "Authorization": f"Bearer {GITHUB_TOKEN}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}

MAX_FILE_SIZE = 500_000  # 500 KB — skip very large files

# File extensions to include (source code only)
INCLUDE_EXTENSIONS = {
    ".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".java", ".rs",
    ".cpp", ".c", ".cs", ".rb", ".php", ".swift", ".kt", ".md",
    ".yaml", ".yml", ".json", ".toml", ".env.example", ".sh",
}


def fetch_file_tree(owner: str, repo: str, sha: str = "HEAD") -> list[dict]:
    """Return list of file metadata dicts from the repo tree."""
    url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/{sha}?recursive=1"
    r = httpx.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    data = r.json()
    return [
        item for item in data.get("tree", [])
        if item["type"] == "blob"
        and item.get("size", 0) < MAX_FILE_SIZE
        and any(item["path"].endswith(ext) for ext in INCLUDE_EXTENSIONS)
    ]


def fetch_file_content(owner: str, repo: str, path: str) -> str:
    """Fetch and decode a single file's content."""
    url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}"
    r = httpx.get(url, headers=HEADERS, timeout=30)
    if r.status_code != 200:
        return ""
    data = r.json()
    if data.get("encoding") == "base64":
        return base64.b64decode(data["content"]).decode("utf-8", errors="replace")
    return data.get("content", "")


def fetch_commits_by_contributor(
    owner: str, repo: str, login: str, since: str | None = None
) -> list[dict]:
    """Fetch commit messages for a contributor — equivalent of transcript for that person."""
    url = f"https://api.github.com/repos/{owner}/{repo}/commits"
    params = {"author": login, "per_page": 100}
    if since:
        params["since"] = since
    r = httpx.get(url, headers=HEADERS, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


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


def build_contributor_text(owner: str, repo: str, login: str) -> str:
    """
    Build contributor-specific text from their commit messages.
    Equivalent of a transcript scoped to one contributor.
    """
    commits = fetch_commits_by_contributor(owner, repo, login)
    lines = [f"Contributor: {login}", f"Total commits: {len(commits)}", ""]
    for commit in commits:
        msg = commit.get("commit", {}).get("message", "")
        date = commit.get("commit", {}).get("author", {}).get("date", "")
        lines.append(f"[{date}] {msg}")
    return "\n".join(lines)


def get_latest_sha(owner: str, repo: str) -> str:
    url = f"https://api.github.com/repos/{owner}/{repo}/commits/HEAD"
    r = httpx.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()["sha"]